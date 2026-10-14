"""Versioned doctor-only quality decisions; routing remains in LangGraph."""

import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from web.auth import LoginUser
from web.chat.supplement import doctor_notes
from web.deps import get_db
from web.response import BaseResponse
from web.routers.workflow import envelope, workflow_user
from web.schemas.review import QualityDecision, ReviewDetail, ReviewSummary, ReviewVersions
from web.workflow.definition import ACTION_VERSION, GRAPH_HASH, GRAPH_VERSION
from web.workflow.models import InferenceEnvelopeRow, Job, ReviewTask, UploadInput, Workflow, WorkflowEvent
from web.workflow.worker import database_now

router = APIRouter(prefix="/reviews/tasks", tags=["doctor-quality-review"])


def review_doctor(user: LoginUser = Depends(workflow_user)) -> LoginUser:
    if user.userRole != "doctor":
        raise HTTPException(403, "仅医生可执行质量复核")
    return user


def authorize(task: ReviewTask, workflow: Workflow, user: LoginUser) -> None:
    if task.review_type != "IMAGE_QUALITY_GATE" or workflow.owner_user_id == int(user.id):
        raise HTTPException(403, "无权复核此任务，禁止审核自己的病例")
    if task.assigned_doctor_id is not None and task.assigned_doctor_id != int(user.id):
        raise HTTPException(403, "任务已由其他医生领取")


def load_task(db: Session, task_id: str, user: LoginUser):
    task = db.get(ReviewTask, task_id)
    if task is None:
        raise HTTPException(404, "复核任务不存在")
    # All writers lock Workflow before ReviewTask, including the worker.
    workflow = db.scalar(select(Workflow).where(Workflow.workflow_id == task.workflow_id)
                         .with_for_update().execution_options(populate_existing=True))
    assert workflow is not None
    # Refresh on reads too: a claim may commit while this request waits on the
    # workflow lock. Never authorize images/details from the earlier snapshot.
    task = db.scalar(select(ReviewTask).where(ReviewTask.task_id == task_id)
                     .with_for_update().execution_options(populate_existing=True))
    assert task is not None
    authorize(task, workflow, user)
    return task, workflow


def summary(task: ReviewTask) -> dict:
    return {"reviewTaskId": task.task_id, "workflowId": task.workflow_id,
            "reviewType": task.review_type, "status": task.status,
            "taskVersion": str(task.version), "workflowVersion": str(task.workflow_version),
            "assignedDoctorId": str(task.assigned_doctor_id) if task.assigned_doctor_id else None,
            "decisionCode": task.decision, "reasonCode": task.reason}


def check_current(task: ReviewTask, workflow: Workflow, body: ReviewVersions, db: Session) -> None:
    upload = db.get(UploadInput, workflow.workflow_id)
    if (task.version != int(body.expectedTaskVersion) or
            task.workflow_version != int(body.expectedWorkflowVersion) or
            workflow.version != task.workflow_version or workflow.status != "WAITING_HUMAN_REVIEW" or
            workflow.stop_reason != "QUALITY_REVIEW_REQUIRED" or
            (workflow.graph_version, workflow.graph_hash, workflow.action_version) !=
            (GRAPH_VERSION, GRAPH_HASH, ACTION_VERSION) or
            (task.graph_version, task.graph_hash, task.action_version) !=
            (workflow.graph_version, workflow.graph_hash, workflow.action_version) or
            task.envelope_id != workflow.inference_envelope_id or upload is None or
            task.checkpoint_id != upload.checkpoint_id):
        raise HTTPException(409, "复核任务、工作流或图版本已变化，请刷新后重试")


def audit(db: Session, task: ReviewTask, workflow: Workflow, user: LoginUser, action: str, now) -> None:
    db.add(WorkflowEvent(event_id=uuid4().hex, workflow_id=workflow.workflow_id,
        sequence=workflow.version + 1, event_type=action, actor_type="DOCTOR", actor_id=str(user.id),
        version=workflow.version, segment=workflow.segment, reason=task.reason, occurred_at=now,
        payload=json.dumps({"reviewTaskId": task.task_id, "taskVersion": str(task.version),
                            "decisionCode": task.decision, "inferenceEnvelopeId": task.envelope_id})))


@router.get("", response_model=BaseResponse[list[ReviewSummary]])
def list_tasks(user: LoginUser = Depends(review_doctor), db: Session = Depends(get_db)) -> dict:
    tasks = db.scalars(select(ReviewTask).join(Workflow, Workflow.workflow_id == ReviewTask.workflow_id)
        .where(ReviewTask.review_type == "IMAGE_QUALITY_GATE",
               ReviewTask.status.in_(["OPEN", "CLAIMED"]), Workflow.owner_user_id != int(user.id),
               ReviewTask.graph_version == GRAPH_VERSION, ReviewTask.graph_hash == GRAPH_HASH,
               ReviewTask.action_version == ACTION_VERSION,
               (ReviewTask.assigned_doctor_id.is_(None)) | (ReviewTask.assigned_doctor_id == int(user.id)))
        .order_by(ReviewTask.created_at, ReviewTask.task_id).limit(100))
    return envelope([summary(task) for task in tasks])


@router.get("/{taskId}", response_model=BaseResponse[ReviewDetail])
def detail(taskId: str, user: LoginUser = Depends(review_doctor), db: Session = Depends(get_db)) -> dict:
    task, workflow = load_task(db, taskId, user)
    row = db.get(InferenceEnvelopeRow, task.envelope_id)
    if row is None or row.workflow_id != task.workflow_id:
        raise HTTPException(409, "原推理结果包不可用")
    return envelope({**summary(task), "question": workflow.question or "",
        "supplementaryNotes": doctor_notes(db, task.workflow_id),
        "allowedDecisions": ["APPROVE_CONTINUE", "REJECT_RESUBMIT"] if task.status != "SUBMITTED" else [],
        "inferenceEnvelopeId": row.envelope_id, "inferenceEpoch": str(row.inference_epoch),
        "inputDigest": row.input_digest, "qualityOutcome": row.quality_outcome,
        "qualityScore": row.quality_score, "qualityReasons": json.loads(row.quality_reasons),
        "modelVersion": row.model_version, "modelWeightFingerprint": row.model_fingerprint,
        "preprocessVersion": row.preprocess_version, "inferencePolicyVersion": row.policy_version,
        "graphDefinitionVersion": task.graph_version})


@router.get("/{taskId}/image")
def image(taskId: str, user: LoginUser = Depends(review_doctor), db: Session = Depends(get_db)) -> Response:
    task, _ = load_task(db, taskId, user)
    upload = db.get(UploadInput, task.workflow_id)
    row = db.get(InferenceEnvelopeRow, task.envelope_id)
    if upload is None or row is None:
        raise HTTPException(409, "复核图片不可用")
    return Response(upload.image_bytes, media_type=row.media_type,
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/{taskId}/claim", response_model=BaseResponse[ReviewSummary])
def claim(taskId: str, body: ReviewVersions, user: LoginUser = Depends(review_doctor),
          db: Session = Depends(get_db)) -> dict:
    task, workflow = load_task(db, taskId, user)
    check_current(task, workflow, body, db)
    if task.status != "OPEN":
        raise HTTPException(409, "任务已领取，请刷新")
    now = database_now(db)
    task.status, task.assigned_doctor_id, task.claimed_at = "CLAIMED", int(user.id), now
    task.version += 1
    workflow.version += 1
    task.workflow_version = workflow.version
    task.updated_at = workflow.updated_at = now
    audit(db, task, workflow, user, "QUALITY_REVIEW_CLAIMED", now)
    db.commit()
    return envelope(summary(task))


@router.post("/{taskId}/submit", response_model=BaseResponse[ReviewSummary])
def submit(taskId: str, body: QualityDecision, user: LoginUser = Depends(review_doctor),
           db: Session = Depends(get_db)) -> dict:
    task, workflow = load_task(db, taskId, user)
    if body.reasonCode != {"APPROVE_CONTINUE": "QUALITY_APPROVED",
                           "REJECT_RESUBMIT": "QUALITY_REJECTED"}[body.decisionCode]:
        raise HTTPException(422, "决定与理由不兼容")
    # An exact replay is a receipt, even after the worker advances the workflow.
    if task.status == "SUBMITTED":
        if (task.submitted_doctor_id == int(user.id) and task.decision == body.decisionCode and
                task.reason == body.reasonCode and task.version == int(body.expectedTaskVersion) + 1 and
                task.workflow_version == int(body.expectedWorkflowVersion)):
            return envelope(summary(task))
        raise HTTPException(409, "复核决定已提交，不能覆盖")
    check_current(task, workflow, body, db)
    if task.status != "CLAIMED" or task.assigned_doctor_id != int(user.id):
        raise HTTPException(409, "请先领取复核任务")
    now = database_now(db)
    task.status, task.decision, task.reason = "SUBMITTED", body.decisionCode, body.reasonCode
    task.submitted_doctor_id, task.submitted_at, task.updated_at = int(user.id), now, now
    task.version += 1
    workflow.status, workflow.stop_reason, workflow.updated_at = "QUEUED", None, now
    workflow.version += 1
    last_job = db.scalar(select(Job).where(Job.workflow_id == workflow.workflow_id)
                         .order_by(Job.epoch.desc()).limit(1).with_for_update())
    assert last_job is not None
    db.add(Job(job_id=uuid4().hex, workflow_id=workflow.workflow_id, job_type="RESUME",
               epoch=last_job.epoch + 1, thread_id=task.thread_id, checkpoint_id=task.checkpoint_id,
               available_at=now, created_at=now, updated_at=now))
    audit(db, task, workflow, user, "QUALITY_REVIEW_SUBMITTED", now)
    db.commit()
    return envelope(summary(task))

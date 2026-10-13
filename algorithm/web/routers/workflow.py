"""New async upload API. Existing synchronous diagnosis contract is unchanged."""

import hashlib
import json
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from web.auth import LoginUser, get_login_user
from web.deps import get_db
from web.files import MAX_PICTURE_BYTES
from web.response import BaseResponse
from web.schemas.workflow import WorkflowStatusView
from web.workflow.definition import ACTION_VERSION, GRAPH_HASH, GRAPH_VERSION
from web.workflow.models import InferenceEnvelopeRow, Job, ReviewTask, UploadInput, Workflow, WorkflowEvent

router = APIRouter(prefix="/diagnosis/workflows", tags=["workflows"])


async def workflow_user(user: LoginUser | None = Depends(get_login_user)) -> LoginUser:
    if user is None:
        raise HTTPException(401, detail={"code": 40100, "msg": "请先登录"})
    return user


def workflow_view(workflow: Workflow, upload: UploadInput, db: Session) -> dict:
    completed = json.loads(upload.completed_nodes)
    inference = db.get(InferenceEnvelopeRow, workflow.inference_envelope_id) if workflow.inference_envelope_id else None
    review = db.scalar(select(ReviewTask).where(ReviewTask.workflow_id == workflow.workflow_id,
                                               ReviewTask.review_type == "IMAGE_QUALITY_GATE"))
    return {
        "workflowId": workflow.workflow_id, "status": workflow.status,
        "workflowVersion": str(workflow.version), "segment": workflow.segment,
        "graphDefinitionVersion": workflow.graph_version,
        "progress": {"current": workflow.segment, "completed": completed},
        "stopReasonCode": workflow.stop_reason,
        "qualityGate": inference.quality_outcome if inference and "imageQuality" in completed else None,
        "qualityReview": {"status": review.status, "decisionCode": review.decision,
                          "reasonCode": review.reason} if review else None,
        "resultAvailability": {"patientVisible": False,
                               "doctorReviewRequired": workflow.status == "WAITING_HUMAN_REVIEW"},
        "result": None,
    }


def envelope(data: dict | list) -> dict:
    return {"code": 0, "msg": "ok", "data": data}


@router.post("", status_code=202, response_model=BaseResponse[WorkflowStatusView])
async def create_workflow(
    file: UploadFile = File(...),
    idempotencyKey: str = Form(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
    question: str = Form("", max_length=4000),
    user: LoginUser = Depends(workflow_user),
    db: Session = Depends(get_db),
) -> dict:
    data = await file.read(MAX_PICTURE_BYTES + 1)
    if not data or len(data) > MAX_PICTURE_BYTES:
        raise HTTPException(413, "图片不能为空且不能超过 2MB")
    digest = hashlib.sha256(len(data).to_bytes(8, "big") + data + question.encode()).hexdigest()
    owner = int(user.id)
    query = select(Workflow).where(Workflow.owner_user_id == owner,
                                   Workflow.idempotency_key == idempotencyKey)

    def existing_response(existing: Workflow) -> dict:
        # Refresh the identity-map entry with a current, locking read before
        # reading the input. Both parts must describe the same committed version.
        db.refresh(existing, with_for_update=True)
        upload = db.scalar(select(UploadInput).where(
            UploadInput.workflow_id == existing.workflow_id).with_for_update())
        assert upload is not None
        if upload.request_digest != digest:
            raise HTTPException(409, "幂等键已用于不同内容，请为新任务使用新键")
        return envelope(workflow_view(existing, upload, db))

    existing = db.scalar(query)
    if existing:
        return existing_response(existing)
    workflow_id = uuid4().hex
    workflow = Workflow(workflow_id=workflow_id, owner_user_id=owner,
                        idempotency_key=idempotencyKey, status="QUEUED",
                        graph_version=GRAPH_VERSION, graph_hash=GRAPH_HASH,
                        action_version=ACTION_VERSION, question=question)
    upload = UploadInput(workflow_id=workflow_id, request_digest=digest, image_bytes=data)
    try:
        with db.begin_nested():
            db.add_all([workflow, upload, Job(job_id=uuid4().hex, workflow_id=workflow_id,
                                             job_type="START", thread_id=workflow_id),
                        WorkflowEvent(event_id=uuid4().hex, workflow_id=workflow_id,
                                      sequence=1, event_type="QUEUED", actor_type="USER",
                                      actor_id=str(owner), version=0)])
            db.flush()
    except IntegrityError:
        # Current read after a uniqueness race, including MySQL REPEATABLE READ.
        existing = db.scalar(query.with_for_update())
        if existing is None:
            raise
        return existing_response(existing)
    # Acknowledgement must follow the durable commit, not response teardown.
    db.commit()
    return envelope(workflow_view(workflow, upload, db))


@router.get("/{workflowId}", response_model=BaseResponse[WorkflowStatusView])
def get_workflow(workflowId: str, user: LoginUser = Depends(workflow_user),
                 db: Session = Depends(get_db)) -> dict:
    workflow = db.get(Workflow, workflowId)
    if workflow is None:
        raise HTTPException(404, "任务不存在")
    if workflow.owner_user_id != int(user.id):
        raise HTTPException(403, "无权查看此任务")
    upload = db.get(UploadInput, workflowId)
    assert upload is not None
    return envelope(workflow_view(workflow, upload, db))

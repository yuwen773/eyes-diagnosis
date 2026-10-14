"""Shared creation and patient view for both upload and chat entrances."""

import hashlib
import json
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from web.files import MAX_PICTURE_BYTES
from web.evidence import evidence_view
from web.workflow.definition import ACTION_VERSION, GRAPH_HASH, GRAPH_VERSION
from web.workflow.models import InferenceEnvelopeRow, Job, ReviewTask, UploadInput, Workflow, WorkflowEvent
from web.workflow.explanation import patient_explanation
from web.workflow.review import review_audit


def workflow_view(workflow: Workflow, upload: UploadInput, db: Session) -> dict:
    db.refresh(workflow, with_for_update=True)
    db.refresh(upload, with_for_update=True)
    completed = json.loads(upload.completed_nodes)
    inference = db.get(InferenceEnvelopeRow, workflow.inference_envelope_id) if workflow.inference_envelope_id else None
    review = db.scalar(select(ReviewTask).where(ReviewTask.workflow_id == workflow.workflow_id,
                                               ReviewTask.review_type == "IMAGE_QUALITY_GATE"))
    final_review = db.scalar(select(ReviewTask).where(ReviewTask.workflow_id == workflow.workflow_id,
                                                     ReviewTask.review_type == "FINAL_CLINICAL_REVIEW"))
    evidence = json.loads(upload.evidence_snapshot) if upload.evidence_snapshot else None
    explanation, result = patient_explanation(db, workflow, evidence)
    return {
        "workflowId": workflow.workflow_id, "status": workflow.status,
        "workflowVersion": str(workflow.version), "segment": workflow.segment,
        "graphDefinitionVersion": workflow.graph_version,
        "progress": {"current": workflow.segment, "completed": completed},
        "stopReasonCode": workflow.stop_reason,
        "qualityGate": inference.quality_outcome if inference and "imageQuality" in completed else None,
        "qualityReview": {"status": review.status, "decisionCode": review.decision,
                          "reasonCode": review.reason} if review else None,
        "finalReview": {"status": final_review.status, "decisionCode": final_review.decision,
                        "reasonCode": final_review.reason, "audit": review_audit(db, workflow.workflow_id)} if final_review else None,
        "evidence": evidence_view(db, evidence) if evidence else None,
        "explanation": explanation,
        "resultAvailability": {"patientVisible": result is not None,
                               "doctorReviewRequired": workflow.status == "WAITING_HUMAN_REVIEW"},
        "result": result,
    }


def owned_workflow(db: Session, workflow_id: str, user_id: int) -> Workflow:
    workflow = db.get(Workflow, workflow_id)
    if workflow is None:
        raise HTTPException(404, "任务不存在")
    if workflow.owner_user_id != user_id:
        raise HTTPException(403, "无权查看此任务")
    return workflow


def create_or_get(db: Session, owner: int, data: bytes, key: str, question: str) -> Workflow:
    """Stage one durable operation. Caller commits it with any chat association."""
    if not data or len(data) > MAX_PICTURE_BYTES:
        raise HTTPException(413, "图片不能为空且不能超过 2MB")
    digest = hashlib.sha256(len(data).to_bytes(8, "big") + data + question.encode()).hexdigest()
    query = select(Workflow).where(Workflow.owner_user_id == owner, Workflow.idempotency_key == key)

    def existing_response(existing: Workflow) -> Workflow:
        db.refresh(existing, with_for_update=True)
        upload = db.scalar(select(UploadInput).where(
            UploadInput.workflow_id == existing.workflow_id).with_for_update())
        assert upload is not None
        if upload.request_digest != digest:
            raise HTTPException(409, "幂等键已用于不同内容，请为新任务使用新键")
        return existing

    existing = db.scalar(query)
    if existing:
        return existing_response(existing)
    workflow_id = uuid4().hex
    workflow = Workflow(workflow_id=workflow_id, owner_user_id=owner,
                        idempotency_key=key, status="QUEUED",
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
        existing = db.scalar(query.with_for_update())
        if existing is None:
            raise
        return existing_response(existing)
    return workflow

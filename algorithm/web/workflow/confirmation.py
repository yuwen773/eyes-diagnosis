"""Freeze consent, then recheck publication and commit one formal diagnosis."""

import hashlib
import json
from datetime import timedelta, timezone
from typing import cast
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.orm import Session

from web.db import id_generator
from web.models.diagnosis import Diagnosis
from web.schemas.confirmation import SaveDecision, SaveRequest
from web.workflow.confirmation_models import SaveConfirmation, SavedWorkflowDiagnosis
from web.workflow.explanation import patient_explanation
from web.workflow.models import InferenceEnvelopeRow, ReviewTask, UploadInput, Workflow
from web.workflow.legacy import require_python_input


def canonical(content: dict) -> str:
    return json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def require_current_graph(workflow: Workflow) -> None:
    # Import lazily: the graph's publication nodes also use confirmation helpers.
    from web.workflow.definition import ACTION_VERSION, GRAPH_HASH, GRAPH_VERSION

    if (workflow.graph_version, workflow.graph_hash, workflow.action_version) != (
            GRAPH_VERSION, GRAPH_HASH, ACTION_VERSION):
        raise HTTPException(409, "工作流图版本不兼容，保留原保存确认，请使用兼容版本恢复")


def locked_workflow(db: Session, workflow_id: str, user_id: int) -> Workflow:
    workflow = db.scalar(select(Workflow).where(Workflow.workflow_id == workflow_id)
                         .with_for_update().execution_options(populate_existing=True))
    if workflow is None:
        raise HTTPException(404, "任务不存在")
    if workflow.owner_user_id != user_id:
        raise HTTPException(403, "无权保存此任务")
    require_python_input(db, workflow_id)
    return workflow


def candidate(db: Session, workflow: Workflow) -> dict | None:
    upload = db.get(UploadInput, workflow.workflow_id)
    inference = db.get(InferenceEnvelopeRow, workflow.inference_envelope_id)
    if (upload is None or inference is None or inference.outcome != "VALID_PREDICTION"
            or workflow.exposure_status != "AVAILABLE" or inference.quality_outcome == "REJECT"
            or hashlib.sha256(upload.image_bytes).hexdigest() != inference.input_digest):
        return None
    reviews = list(db.scalars(select(ReviewTask).where(ReviewTask.workflow_id == workflow.workflow_id)
                            .with_for_update().execution_options(populate_existing=True)))
    if any(row.status != "SUBMITTED" or row.decision != {
            "IMAGE_QUALITY_GATE": "APPROVE_CONTINUE",
            "FINAL_CLINICAL_REVIEW": "CONFIRM_AI_ASSESSMENT"}.get(row.review_type) for row in reviews):
        return None
    final = next((row for row in reviews if row.review_type == "FINAL_CLINICAL_REVIEW"), None)
    assert inference.confidence_snapshot is not None
    if json.loads(inference.confidence_snapshot)["requiresReview"] and final is None:
        return None
    if inference.quality_outcome == "REVIEW" and not any(
            row.review_type == "IMAGE_QUALITY_GATE" for row in reviews):
        return None
    _, result = patient_explanation(db, workflow,
        json.loads(upload.evidence_snapshot) if upload.evidence_snapshot else None)
    if result is None:
        return None
    return {"imageUrl": f"/api/diagnosis/workflows/{workflow.workflow_id}/image",
        "imageDigest": hashlib.sha256(upload.image_bytes).hexdigest(),
        "result": result["modelAssessment"]["diseaseCode"],
        "calibratedProbability": result["modelAssessment"]["calibratedProbability"],
        "severity": "NOT_ASSESSED", "details": result["riskNotice"],
        "explanation": result, "finalReviewTaskId": final.task_id if final else None}


def confirmation_view(db: Session, row: SaveConfirmation) -> dict:
    now = db.scalar(select(func.current_timestamp()))
    assert now is not None
    if row.status == "PENDING" and row.expires_at <= now:
        row.status = "EXPIRED"
        row.decided_at = now
    saved = db.scalar(select(SavedWorkflowDiagnosis).where(SavedWorkflowDiagnosis.workflow_id == row.workflow_id)
                      .with_for_update().execution_options(populate_existing=True))
    return {"confirmationId": row.confirmation_id, "workflowId": row.workflow_id,
        "operationType": row.operation, "status": row.status, "idempotencyKey": row.idempotency_key,
        "workflowVersion": str(row.workflow_version), "contentDigest": row.content_digest,
        "content": json.loads(row.content), "expiresAt": row.expires_at.replace(tzinfo=(
            timezone(timedelta(hours=8)) if db.get_bind().dialect.name == "mysql" else timezone.utc)).isoformat(),
        "diagnosisId": str(saved.diagnosis_id) if saved else None}


def current_confirmation(db: Session, workflow_id: str) -> SaveConfirmation | None:
    saved = db.scalar(select(SavedWorkflowDiagnosis).where(SavedWorkflowDiagnosis.workflow_id == workflow_id)
                      .with_for_update().execution_options(populate_existing=True))
    if saved:
        return db.get(SaveConfirmation, saved.confirmation_id)
    return db.scalar(select(SaveConfirmation).where(SaveConfirmation.workflow_id == workflow_id)
                     .order_by(SaveConfirmation.request_version.desc()).limit(1).with_for_update()
                     .execution_options(populate_existing=True))


def request_save(db: Session, workflow_id: str, user_id: int, body: SaveRequest) -> dict:
    workflow = locked_workflow(db, workflow_id, user_id)
    existing = db.scalar(select(SaveConfirmation).where(SaveConfirmation.owner_user_id == user_id,
        SaveConfirmation.idempotency_key == body.idempotencyKey).with_for_update())
    if existing:
        explanation = json.loads(existing.content)["explanation"]
        if (existing.workflow_id != workflow_id or str(existing.workflow_version) != body.expectedWorkflowVersion
                or explanation["snapshotId"] != body.expectedExplanationSnapshotId
                or explanation["revision"] != body.expectedExplanationRevision):
            raise HTTPException(409, "确认幂等键已绑定其他内容")
        return confirmation_view(db, existing)
    saved = db.get(SavedWorkflowDiagnosis, workflow_id)
    if saved:
        approved = db.get(SaveConfirmation, saved.confirmation_id)
        assert approved is not None
        return confirmation_view(db, approved)
    require_current_graph(workflow)
    content = candidate(db, workflow)
    if content is None:
        db.commit()  # Persist a source revocation detected by patient_explanation.
        raise HTTPException(409, "任务尚未满足解释发布及临床复核条件，不能保存")
    if (str(workflow.version) != body.expectedWorkflowVersion or
            content["explanation"]["snapshotId"] != body.expectedExplanationSnapshotId or
            content["explanation"]["revision"] != body.expectedExplanationRevision):
        raise HTTPException(409, "结果版本已变化，请刷新后重新确认")
    previous = current_confirmation(db, workflow_id)
    if previous and confirmation_view(db, previous)["status"] == "PENDING":
        if previous.workflow_version == workflow.version and previous.content == canonical(content):
            return confirmation_view(db, previous)
        previous.status = "INVALIDATED"
    now = db.scalar(select(func.current_timestamp()))
    assert now is not None
    frozen = canonical(content)
    row = SaveConfirmation(confirmation_id=uuid4().hex, owner_user_id=user_id, workflow_id=workflow_id,
        operation="SAVE_DIAGNOSIS", idempotency_key=body.idempotencyKey, workflow_version=workflow.version,
        request_version=previous.request_version + 1 if previous else 1,
        content=frozen, content_digest=hashlib.sha256(frozen.encode()).hexdigest(), status="PENDING",
        created_at=now, expires_at=now + timedelta(minutes=30))
    db.add(row)
    db.flush()
    return confirmation_view(db, row)


def decide_save(db: Session, workflow_id: str, confirmation_id: str, user_id: int,
                body: SaveDecision, approve: bool) -> dict:
    workflow = locked_workflow(db, workflow_id, user_id)
    row = db.scalar(select(SaveConfirmation).where(SaveConfirmation.confirmation_id == confirmation_id)
                    .with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, "确认请求不存在")
    if row.owner_user_id != user_id or row.workflow_id != workflow_id:
        raise HTTPException(403, "确认请求不属于当前用户及任务")
    if (row.operation != "SAVE_DIAGNOSIS" or row.idempotency_key != body.idempotencyKey or
            row.content_digest != body.expectedContentDigest or
            str(row.workflow_version) != body.expectedWorkflowVersion):
        raise HTTPException(409, "确认内容或版本不匹配，请刷新")
    if row.status == "PENDING":
        require_current_graph(workflow)
    view = confirmation_view(db, row)
    target = "APPROVED" if approve else "REJECTED"
    if row.status == target:
        return view  # A committed receipt is replayed; it never reexecutes the write.
    if row.status != "PENDING":
        db.commit()
        raise HTTPException(409, "确认已拒绝、过期或失效，请重新查看结果")
    content = candidate(db, workflow) if approve else None
    if approve and (workflow.version != row.workflow_version or content is None or canonical(content) != row.content):
        row.status = "INVALIDATED"
        row.decided_at = db.scalar(select(func.current_timestamp()))
        db.commit()
        raise HTTPException(409, "发布条件或内容版本已变化，请刷新后重新确认")
    # CAS also fences concurrent requests on databases without SELECT FOR UPDATE.
    changed = cast(CursorResult, db.execute(update(SaveConfirmation).where(SaveConfirmation.confirmation_id == confirmation_id,
        SaveConfirmation.status == "PENDING", SaveConfirmation.expires_at > func.current_timestamp())
        .values(status=target, decided_at=func.current_timestamp())
        .execution_options(synchronize_session=False))).rowcount
    if changed != 1:
        db.refresh(row)
        confirmation_view(db, row)
        db.commit()
        raise HTTPException(409, "确认状态已变化，请刷新")
    if approve:
        assert content is not None
        inference = db.get(InferenceEnvelopeRow, workflow.inference_envelope_id)
        assert inference is not None
        diagnosis_id = id_generator.next_id()
        ood = json.loads(inference.ood_snapshot)
        final = db.get(ReviewTask, content["finalReviewTaskId"]) if content["finalReviewTaskId"] else None
        db.add(Diagnosis(id=diagnosis_id, user_id=user_id, url=content["imageUrl"], result=content["result"],
            calibrated_probability=content["calibratedProbability"], severity=content["severity"],
            details=content["details"], create_time=db.scalar(select(func.current_timestamp())), is_delete=0,
            ai_rejected=False, model_version=inference.model_version, weight_sha256=inference.model_fingerprint,
            preprocess_version=inference.preprocess_version, inference_policy_version=inference.policy_version,
            calibration_status=content["explanation"]["modelAssessment"]["calibrationStatus"],
            quality_score=inference.quality_score, quality_reasons=",".join(json.loads(inference.quality_reasons)),
            ood_status=ood["status"], ood_score=ood["score"],
            human_review_status="REVIEWED" if final else "AI_ONLY",
            human_reviewer_id=final.submitted_doctor_id if final else None,
            human_reviewed_at=final.submitted_at if final else None))
        db.add(SavedWorkflowDiagnosis(workflow_id=workflow_id, diagnosis_id=diagnosis_id,
                                     confirmation_id=confirmation_id))
    db.flush()  # Consent, receipt and formal row succeed or roll back together.
    db.refresh(row)
    return confirmation_view(db, row)

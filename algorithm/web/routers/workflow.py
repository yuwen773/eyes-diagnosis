"""New async upload API. Existing synchronous diagnosis contract is unchanged."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select

from web.auth import LoginUser, get_login_user
from web.deps import get_db
from web.files import MAX_PICTURE_BYTES
from web.response import BaseResponse
from web.schemas.workflow import WorkflowStatusView
from web.schemas.confirmation import SaveRequest, SaveDecision, SaveConfirmationView
from web.workflow.confirmation import (
    locked_workflow, current_confirmation, confirmation_view, request_save, decide_save,
)
from web.workflow.models import UploadInput
from web.workflow.models import Workflow
from web.workflow.confirmation_models import SavedWorkflowDiagnosis
from web.models.diagnosis import Diagnosis
from web.chat.supplement import Supplement, view as supplement_view
from web.schemas.supplement import SupplementView
from web.events import sse
from web.workflow.service import create_or_get, owned_workflow, workflow_view
from web.workflow.legacy import require_python_input

router = APIRouter(prefix="/diagnosis/workflows", tags=["workflows"])


async def workflow_user(user: LoginUser | None = Depends(get_login_user)) -> LoginUser:
    if user is None:
        raise HTTPException(401, detail={"code": 40100, "msg": "请先登录"})
    return user


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
    workflow = create_or_get(db, int(user.id), data, idempotencyKey, question)
    db.commit()
    upload = db.get(UploadInput, workflow.workflow_id)
    assert upload is not None
    return envelope(workflow_view(workflow, upload, db))


@router.get("/{workflowId}", response_model=BaseResponse[WorkflowStatusView])
def get_workflow(workflowId: str, user: LoginUser = Depends(workflow_user),
                 db: Session = Depends(get_db)) -> dict:
    workflow = owned_workflow(db, workflowId, int(user.id))
    upload = db.get(UploadInput, workflowId)
    assert upload is not None
    return envelope(workflow_view(workflow, upload, db))


@router.get("/{workflowId}/image")
def workflow_image(workflowId: str, user: LoginUser = Depends(workflow_user),
                   db: Session = Depends(get_db)) -> Response:
    workflow = db.get(Workflow, workflowId)
    if workflow is None:
        raise HTTPException(404, "任务不存在")
    if workflow.owner_user_id != int(user.id):
        receipt = db.get(SavedWorkflowDiagnosis, workflowId)
        diagnosis = db.get(Diagnosis, receipt.diagnosis_id) if receipt else None
        if user.userRole != "admin" or diagnosis is None or diagnosis.is_delete != 0:
            raise HTTPException(403, "无权查看此图片")
    upload = require_python_input(db, workflow.workflow_id)
    import io
    from PIL import Image, UnidentifiedImageError
    try:
        with Image.open(io.BytesIO(upload.image_bytes)) as image:
            media_type = Image.MIME.get(image.format or "", "application/octet-stream")
    except UnidentifiedImageError:
        raise HTTPException(404, "有效图片不存在") from None
    return Response(upload.image_bytes, media_type=media_type, headers={"Cache-Control": "private, no-store"})


@router.get("/{workflowId}/events")
def workflow_events(workflowId: str, user: LoginUser = Depends(workflow_user),
                    db: Session = Depends(get_db)) -> StreamingResponse:
    """One authoritative snapshot per GET; done ends transport, not the task.

    Clients renew this bounded stream, including after terminal workflow states:
    consent and supplementary interactions can still change. Each renewal checks
    Java identity and ownership; no transaction or identity cache spans renewals.
    """
    workflow = locked_workflow(db, workflowId, int(user.id))
    upload = db.get(UploadInput, workflowId)
    assert upload is not None
    state = WorkflowStatusView.model_validate(workflow_view(workflow, upload, db)).model_dump(mode="json")
    waits = [SupplementView.model_validate(supplement_view(row)).model_dump()
             for row in db.scalars(select(Supplement).where(Supplement.workflow_id == workflowId,
                 Supplement.user_id == int(user.id)).order_by(Supplement.created_at, Supplement.request_id))]
    confirmation = current_confirmation(db, workflowId)
    consent = SaveConfirmationView.model_validate(confirmation_view(db, confirmation)).model_dump() if confirmation else None
    payload = {"workflow": state, "supplements": waits, "saveConfirmation": consent}
    # Commit any publication revocation/confirmation expiry before acknowledging it.
    db.commit()
    return StreamingResponse(iter([sse(payload, "state"), sse("", "done")]),
        media_type="text/event-stream", headers={"Cache-Control": "private, no-store",
                                               "X-Accel-Buffering": "no"})


@router.get("/{workflowId}/save-confirmation", response_model=BaseResponse[SaveConfirmationView | None])
def get_save_confirmation(workflowId: str, user: LoginUser = Depends(workflow_user),
                          db: Session = Depends(get_db)) -> dict:
    locked_workflow(db, workflowId, int(user.id))
    row = current_confirmation(db, workflowId)
    return {"code": 0, "msg": "ok", "data": confirmation_view(db, row) if row else None}


@router.post("/{workflowId}/save-confirmation", response_model=BaseResponse[SaveConfirmationView])
def create_save_confirmation(workflowId: str, body: SaveRequest,
                             user: LoginUser = Depends(workflow_user), db: Session = Depends(get_db)) -> dict:
    try:
        data = request_save(db, workflowId, int(user.id), body)
        db.commit()
        return envelope(data)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "确认请求已变化或幂等键已占用，请刷新保存状态") from None


@router.post("/{workflowId}/save-confirmations/{confirmationId}/approve",
             response_model=BaseResponse[SaveConfirmationView])
def approve_save(workflowId: str, confirmationId: str, body: SaveDecision,
                 user: LoginUser = Depends(workflow_user), db: Session = Depends(get_db)) -> dict:
    data = decide_save(db, workflowId, confirmationId, int(user.id), body, True)
    # A successful HTTP response must acknowledge a durable consent + receipt.
    # Request dependency cleanup can run after the response has been sent.
    db.commit()
    return envelope(data)


@router.post("/{workflowId}/save-confirmations/{confirmationId}/reject",
             response_model=BaseResponse[SaveConfirmationView])
def reject_save(workflowId: str, confirmationId: str, body: SaveDecision,
                user: LoginUser = Depends(workflow_user), db: Session = Depends(get_db)) -> dict:
    data = decide_save(db, workflowId, confirmationId, int(user.id), body, False)
    db.commit()
    return envelope(data)

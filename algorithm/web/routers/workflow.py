"""New async upload API. Existing synchronous diagnosis contract is unchanged."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi.responses import Response

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
from web.workflow.service import create_or_get, owned_workflow, workflow_view

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
    upload = db.get(UploadInput, workflow.workflow_id)
    assert upload is not None
    import io
    from PIL import Image, UnidentifiedImageError
    try:
        with Image.open(io.BytesIO(upload.image_bytes)) as image:
            media_type = Image.MIME.get(image.format or "", "application/octet-stream")
    except UnidentifiedImageError:
        raise HTTPException(404, "有效图片不存在") from None
    return Response(upload.image_bytes, media_type=media_type, headers={"Cache-Control": "private, no-store"})


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
        return envelope(request_save(db, workflowId, int(user.id), body))
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "确认请求已变化或幂等键已占用，请刷新保存状态") from None


@router.post("/{workflowId}/save-confirmations/{confirmationId}/approve",
             response_model=BaseResponse[SaveConfirmationView])
def approve_save(workflowId: str, confirmationId: str, body: SaveDecision,
                 user: LoginUser = Depends(workflow_user), db: Session = Depends(get_db)) -> dict:
    return envelope(decide_save(db, workflowId, confirmationId, int(user.id), body, True))


@router.post("/{workflowId}/save-confirmations/{confirmationId}/reject",
             response_model=BaseResponse[SaveConfirmationView])
def reject_save(workflowId: str, confirmationId: str, body: SaveDecision,
                user: LoginUser = Depends(workflow_user), db: Session = Depends(get_db)) -> dict:
    return envelope(decide_save(db, workflowId, confirmationId, int(user.id), body, False))

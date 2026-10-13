"""New async upload API. Existing synchronous diagnosis contract is unchanged."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from web.auth import LoginUser, get_login_user
from web.deps import get_db
from web.files import MAX_PICTURE_BYTES
from web.response import BaseResponse
from web.schemas.workflow import WorkflowStatusView
from web.workflow.models import UploadInput
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

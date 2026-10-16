"""Owner-only legacy view and explicit independent rebuild."""

from fastapi import APIRouter, Depends, Query, File, Form, UploadFile, HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from web.auth import LoginUser
from web.deps import get_db
from web.response import BaseResponse
from web.routers.workflow import workflow_user, envelope
from web.schemas.legacy import LegacyTaskPage, LegacyTaskView
from web.schemas.workflow import WorkflowStatusView
from web.workflow.legacy import legacy_records, owned_legacy, rebuild_legacy
from web.workflow.models import UploadInput
from web.workflow.service import workflow_view
from web.files import MAX_PICTURE_BYTES

router = APIRouter(prefix="/diagnosis/legacy-tasks", tags=["legacyTasks"])


@router.get("", response_model=BaseResponse[LegacyTaskPage])
def list_legacy_tasks(current: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
                      user: LoginUser = Depends(workflow_user), db: Session = Depends(get_db)) -> dict:
    records = legacy_records(db)
    owned = select(records).where(records.c.owner == int(user.id))
    total = db.scalar(select(func.count()).select_from(owned.subquery()))
    rows = db.execute(owned.order_by(records.c.createdAt.desc(), records.c.sourceType, records.c.taskId)
                      .offset((current - 1) * pageSize).limit(pageSize)).mappings()
    return envelope({"records": [dict(row) for row in rows], "total": total})


@router.get("/{sourceType}/{taskId}", response_model=BaseResponse[LegacyTaskView])
def get_legacy_task(sourceType: str, taskId: str, user: LoginUser = Depends(workflow_user),
                    db: Session = Depends(get_db)) -> dict:
    return envelope(owned_legacy(db, sourceType, taskId, int(user.id)))


@router.post("/{sourceType}/{taskId}/rebuild", status_code=202, response_model=BaseResponse[WorkflowStatusView])
def rebuild_legacy_task(
    sourceType: str, taskId: str,
    confirmed: bool = Form(...),
    file: UploadFile = File(...),
    idempotencyKey: str = Form(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
    question: str = Form("", max_length=4000),
    user: LoginUser = Depends(workflow_user), db: Session = Depends(get_db),
) -> dict:
    source = owned_legacy(db, sourceType, taskId, int(user.id))
    if not confirmed:
        raise HTTPException(400, "请明确确认创建独立新任务；旧批准不会转移")
    # Synchronous SQL row locks must run in FastAPI's thread pool: a competing
    # retry must not block the event loop while the first request commits.
    data = file.file.read(MAX_PICTURE_BYTES + 1)
    workflow = rebuild_legacy(db, source, int(user.id), data, idempotencyKey, question)
    db.commit()  # Acknowledges durable input, job and source audit together.
    upload = db.get(UploadInput, workflow.workflow_id)
    assert upload is not None
    return envelope(workflow_view(workflow, upload, db))

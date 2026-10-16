"""Legacy metadata and independent rebuilds; never execute Java checkpoints."""

import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import exists, select, literal, cast, String, union_all, func
from sqlalchemy.orm import Session

from web.workflow.models import Job, PYTHON_SEGMENT_CODE, UploadInput, Workflow, WorkflowEvent
from web.chat.models import LegacyUpload
from web.models.user import User

REBUILD_EVENT = "LEGACY_REBUILD_CONFIRMED"


def require_python_input(db: Session, workflow_id: str) -> UploadInput:
    upload = db.get(UploadInput, workflow_id)
    if upload is None:
        raise HTTPException(409, "任务没有 Python 输入绑定，请通过旧任务视图查看或联系管理员")
    return upload


def legacy_workflows():
    # Python origin is durable input/job ownership, not today's graph version.
    return select(Workflow).where(
        ~exists().where(UploadInput.workflow_id == Workflow.workflow_id),
        ~exists().where(Job.workflow_id == Workflow.workflow_id,
                        Job.segment_code == PYTHON_SEGMENT_CODE),
    )


def legacy_records(db: Session):
    def text_column(value):
        column = cast(value, String)
        # Frozen Java tables and connection literals can use different MySQL
        # collations. Normalize the read projection without changing old DDL.
        return column.collate("utf8mb4_unicode_ci") if db.get_bind().dialect.name == "mysql" else column

    workflow = legacy_workflows().with_only_columns(
        text_column(Workflow.workflow_id).label("taskId"), Workflow.owner_user_id.label("owner"),
        text_column(literal("workflow")).label("sourceType"), text_column(Workflow.status).label("status"),
        Workflow.created_at.label("createdAt"), Workflow.updated_at.label("updatedAt"),
        text_column(Workflow.graph_version).label("sourceVersion"), text_column(Workflow.question).label("question"))
    upload = select(text_column(LegacyUpload.task_id), LegacyUpload.user_id, text_column(literal("upload")),
                    text_column(LegacyUpload.status), LegacyUpload.create_time,
                    LegacyUpload.update_time, text_column(literal("java-upload-v3")), text_column(literal(None)))
    return union_all(workflow, upload).subquery()


def owned_legacy(db: Session, source_type: str, task_id: str, owner: int) -> dict:
    records = legacy_records(db)
    row = db.execute(select(records).where(records.c.sourceType == source_type,
                                          records.c.taskId == task_id)).mappings().first()
    if row is None:
        raise HTTPException(404, "旧任务不存在")
    if row["owner"] != owner:
        raise HTTPException(403, "无权查看此旧任务")
    return dict(row)


def rebuild_source(db: Session, workflow_id: str) -> dict | None:
    event = db.scalar(select(WorkflowEvent).where(WorkflowEvent.workflow_id == workflow_id,
                                                WorkflowEvent.sequence == 1).with_for_update())
    return json.loads(event.payload).get("legacySource") if event and event.payload else None


def rebuild_legacy(db: Session, source: dict, owner: int, data: bytes, key: str, question: str) -> Workflow:
    from web.workflow.service import create_or_get

    # Separate command namespace; the same key must never silently point at a
    # different legacy source, even if the uploaded pixels happen to match.
    creation_key = "legacy:" + hashlib.sha256(key.encode()).hexdigest()
    # Serialize this infrequent migration command per owner. Competing MySQL
    # duplicate inserts otherwise acquire shared unique-key locks and can
    # deadlock when upgrading them to read the winner. Lock an existing row,
    # never a missing workflow-key range; no legacy business row is changed.
    db.scalar(select(User.id).where(User.id == owner).with_for_update())
    existing = db.scalar(select(Workflow).where(Workflow.owner_user_id == owner,
                         Workflow.idempotency_key == creation_key).with_for_update())
    if existing is not None:
        link = rebuild_source(db, existing.workflow_id)
        if link is None or (link["sourceType"], link["taskId"]) != (source["sourceType"], source["taskId"]):
            raise HTTPException(409, "幂等键已用于其他任务，请刷新")
    workflow = create_or_get(db, owner, data, creation_key, question)
    # create_or_get also handles a concurrent unique-key winner. Read its
    # immutable audit before adding anything to the returned workflow.
    link = rebuild_source(db, workflow.workflow_id)
    if link is not None:
        if (link["sourceType"], link["taskId"]) != (source["sourceType"], source["taskId"]):
            raise HTTPException(409, "幂等键已用于其他旧任务")
        return workflow
    now = db.scalar(select(func.now()))
    assert now is not None
    payload = {name: source[name] for name in ("taskId", "sourceType", "createdAt", "status", "sourceVersion")}
    payload["createdAt"] = source["createdAt"].isoformat() if source["createdAt"] else None
    payload.update(confirmedBy=str(owner), confirmedAt=now.isoformat())
    # Enrich the staged QUEUED audit before its first commit. Worker events
    # retain the existing workflowVersion + 1 sequence contract.
    event = db.scalar(select(WorkflowEvent).where(WorkflowEvent.workflow_id == workflow.workflow_id,
                                                 WorkflowEvent.sequence == 1).with_for_update())
    assert event is not None
    event.reason, event.payload = REBUILD_EVENT, json.dumps({"legacySource": payload})
    db.flush()
    return workflow

"""Durable interaction interrupts, independent of clinical routing and consent."""

from datetime import datetime
from typing import TypedDict, cast
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from sqlalchemy import BigInteger, DateTime, String, Text, UniqueConstraint, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Mapped, Session, mapped_column, sessionmaker

from web.chat.models import ChatSession, ChatWorkflow
from web.chat.session import save_message
from web.db import Base
from web.response import BizError, ErrorCode
from web.workflow.checkpoint import MysqlCheckpointSaver, checkpoint_config

GRAPH_VERSION = "chat-supplement-v1"
PROMPT = "请补充本次图片相关说明；没有补充可填写“暂无补充”。"
ACKNOWLEDGEMENT = "已收到本次补充说明，将保留在原会话并提供给复核医生。"


class Supplement(Base):
    __tablename__ = "t_python_chat_supplement"
    __table_args__ = (UniqueConstraint("sessionId", "idempotencyKey"),)

    request_id: Mapped[str] = mapped_column("requestId", String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column("sessionId", String(64), index=True)
    active_session_id: Mapped[str | None] = mapped_column("activeSessionId", String(64), unique=True)
    workflow_id: Mapped[str] = mapped_column("workflowId", String(64), index=True)
    user_id: Mapped[int] = mapped_column("userId", BigInteger)
    idempotency_key: Mapped[str] = mapped_column("idempotencyKey", String(128))
    original_message: Mapped[str] = mapped_column("originalMessage", Text)
    status: Mapped[str] = mapped_column(String(20))
    version: Mapped[int] = mapped_column("waitVersion", BigInteger, default=0)
    answer: Mapped[str | None] = mapped_column(Text)
    graph_version: Mapped[str] = mapped_column("graphVersion", String(64))
    checkpoint_id: Mapped[str] = mapped_column("checkpointId", String(128))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, default=datetime.now)
    answered_at: Mapped[datetime | None] = mapped_column("answeredAt", DateTime)


class SupplementState(TypedDict):
    request: dict
    answer: str


def build_graph(saver):
    def wait_for_description(state: SupplementState) -> dict:
        # No writes or model calls before interrupt: this node re-enters on resume.
        answer = interrupt(state["request"])
        return {"answer": answer}

    graph = StateGraph(SupplementState)
    graph.add_node("waitForDescription", wait_for_description)
    graph.add_edge(START, "waitForDescription")
    graph.add_edge("waitForDescription", END)
    return graph.compile(checkpointer=saver)


def view(row: Supplement) -> dict:
    return {"requestId": row.request_id, "sessionId": row.session_id, "workflowId": row.workflow_id,
            "status": row.status, "version": str(row.version),
            "items": [{"key": "description", "prompt": PROMPT}], "answer": row.answer}


def history(db: Session, session_id: str) -> list[dict]:
    return [view(row) for row in db.scalars(select(Supplement).where(Supplement.session_id == session_id)
            .order_by(Supplement.created_at, Supplement.request_id))]


def doctor_notes(db: Session, workflow_id: str) -> list[str]:
    return list(db.scalars(select(Supplement.answer).where(Supplement.workflow_id == workflow_id,
        Supplement.status == "ANSWERED", Supplement.answer.is_not(None))
        .order_by(Supplement.answered_at, Supplement.request_id)))


def request_wait(db: Session, session: ChatSession, workflow_id: str, key: str, message: str) -> Supplement:
    """Caller owns the session lock; the request and checkpoint commit together."""
    if db.get(ChatWorkflow, (session.session_id, workflow_id)) is None:
        raise BizError(ErrorCode.NO_AUTH_ERROR, "请先将诊断任务关联到当前会话")
    row = db.scalar(select(Supplement).where(Supplement.session_id == session.session_id,
        Supplement.idempotency_key == key).with_for_update())
    if row is not None:
        if row.workflow_id != workflow_id or row.original_message != message:
            raise BizError(ErrorCode.OPERATION_ERROR, "补充请求的幂等键已用于其他内容")
        return row
    if db.scalar(select(Supplement.request_id).where(Supplement.active_session_id == session.session_id)):
        raise BizError(ErrorCode.OPERATION_ERROR, "本会话已有待补充请求，请先回复")
    row = Supplement(request_id=str(uuid4()), session_id=session.session_id,
        active_session_id=session.session_id, workflow_id=workflow_id, user_id=session.user_id,
        idempotency_key=key, original_message=message, status="WAITING", version=0,
        graph_version=GRAPH_VERSION)
    saver = MysqlCheckpointSaver(sessionmaker(bind=db.get_bind()))
    graph = build_graph(saver)
    config = {"configurable": {"thread_id": "supplement:" + row.request_id}}
    result = graph.invoke({"request": view(row)}, config)
    if len(result.get("__interrupt__", [])) != 1:
        raise RuntimeError("Supplement graph did not pause")
    row.checkpoint_id = graph.get_state(config).config["configurable"]["checkpoint_id"]
    saver.flush(db)
    db.add(row)
    save_message(db, session, "USER", message or "补充本次说明")
    prompt = save_message(db, session, "ASSISTANT", PROMPT)
    prompt.sub_type = "supplement-request"
    return row


def resume(db: Session, session: ChatSession, row: Supplement, version: int, text: str) -> Supplement:
    if row.status == "ANSWERED" and version + 1 == row.version and row.answer == text:
        return row
    if row.status != "WAITING" or row.version != version or row.graph_version != GRAPH_VERSION:
        raise BizError(ErrorCode.OPERATION_ERROR, "补充请求或等待版本已变化，请刷新后重试")
    saver = MysqlCheckpointSaver(sessionmaker(bind=db.get_bind()))
    graph = build_graph(saver)
    config = checkpoint_config("supplement:" + row.request_id, "", row.checkpoint_id)
    state = graph.get_state(config)
    if (not state.tasks or not any(task.interrupts for task in state.tasks) or
            state.values.get("request") != view(row)):
        raise BizError(ErrorCode.OPERATION_ERROR, "补充请求恢复信息不可用，请刷新后重试")
    result = graph.invoke(Command(resume=text), config)
    if result.get("__interrupt__") or result.get("answer") != text:
        raise RuntimeError("Supplement graph did not resume")
    changed = cast(CursorResult, db.execute(update(Supplement).where(Supplement.request_id == row.request_id,
        Supplement.status == "WAITING", Supplement.version == version).values(status="ANSWERED",
        version=version + 1, answer=text, active_session_id=None, answered_at=datetime.now())))
    if changed.rowcount != 1:
        raise BizError(ErrorCode.OPERATION_ERROR, "补充请求已回复，请刷新后重试")
    latest = {"configurable": {"thread_id": "supplement:" + row.request_id}}
    row.checkpoint_id = graph.get_state(latest).config["configurable"]["checkpoint_id"]
    saver.flush(db)
    save_message(db, session, "USER", text)
    save_message(db, session, "ASSISTANT", ACKNOWLEDGEMENT)
    return row

"""Legacy chat tables plus additive execution, attachment and audit records."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from web.db import Base, id_generator


class ChatSession(Base):
    __tablename__ = "t_agent_session"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=id_generator.next_id)
    session_id: Mapped[str] = mapped_column("sessionId", String(64), unique=True)
    user_id: Mapped[int] = mapped_column("userId", BigInteger)
    title: Mapped[str] = mapped_column(String(255), default="新会话")
    model_name: Mapped[str | None] = mapped_column("modelName", String(100))
    status: Mapped[int] = mapped_column(Integer, default=1)
    last_message: Mapped[str] = mapped_column("lastMessage", String(500), default="")
    message_count: Mapped[int] = mapped_column("messageCount", Integer, default=0)
    summary_content: Mapped[str | None] = mapped_column("summaryContent", Text)
    summary_at: Mapped[datetime | None] = mapped_column("summaryAt", DateTime)
    checkpoint_data: Mapped[bytes | None] = mapped_column("checkpointData", LargeBinary)
    created_time: Mapped[datetime] = mapped_column("createdTime", DateTime, default=datetime.now)
    updated_time: Mapped[datetime] = mapped_column("updatedTime", DateTime, default=datetime.now)
    expired_time: Mapped[datetime | None] = mapped_column("expiredTime", DateTime)
    is_delete: Mapped[int] = mapped_column("isDelete", Integer, default=0)
    pinned: Mapped[int] = mapped_column(Integer, default=0)
    pin_time: Mapped[datetime | None] = mapped_column("pinTime", DateTime)


class ChatMessage(Base):
    __tablename__ = "t_agent_message"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=id_generator.next_id)
    session_id: Mapped[str] = mapped_column("sessionId", String(64), index=True)
    role: Mapped[str] = mapped_column(String(20))
    sub_type: Mapped[str | None] = mapped_column("subType", String(30), default="text")
    content: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column("tokenCount", Integer, default=0)
    is_summary: Mapped[int] = mapped_column("isSummary", Integer, default=0)
    created_time: Mapped[datetime] = mapped_column("createdTime", DateTime, default=datetime.now)


class ChatRun(Base):
    __tablename__ = "t_python_chat_run"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column("sessionId", String(64), index=True)
    active_session_id: Mapped[str | None] = mapped_column("activeSessionId", String(64), unique=True)
    user_id: Mapped[int] = mapped_column("userId", BigInteger)
    message_id: Mapped[int] = mapped_column("messageId", BigInteger)
    status: Mapped[str] = mapped_column(String(20), default="RUNNING")
    error_code: Mapped[str | None] = mapped_column("errorCode", String(40))
    created_time: Mapped[datetime] = mapped_column("createdTime", DateTime, default=datetime.now)
    deadline: Mapped[datetime] = mapped_column(DateTime)
    finished_time: Mapped[datetime | None] = mapped_column("finishedTime", DateTime)


class ChatAttachment(Base):
    __tablename__ = "t_python_chat_attachment"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column("userId", BigInteger)
    url: Mapped[str] = mapped_column(String(512), unique=True)
    session_id: Mapped[str | None] = mapped_column("sessionId", String(64))
    message_id: Mapped[int | None] = mapped_column("messageId", BigInteger)
    created_time: Mapped[datetime] = mapped_column("createdTime", DateTime, default=datetime.now)
    is_delete: Mapped[int] = mapped_column("isDelete", Integer, default=0)


class ChatAudit(Base):
    __tablename__ = "t_python_chat_audit"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=id_generator.next_id)
    run_id: Mapped[str] = mapped_column("runId", String(36), index=True)
    session_id: Mapped[str] = mapped_column("sessionId", String(64))
    user_id: Mapped[int] = mapped_column("userId", BigInteger)
    event: Mapped[str] = mapped_column(String(40))
    created_time: Mapped[datetime] = mapped_column("createdTime", DateTime, default=datetime.now)


class LegacyUpload(Base):
    """Read-only bridge for already uploaded Java attachments (V3)."""

    __tablename__ = "t_upload_task"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    task_id: Mapped[str] = mapped_column("taskId", String(64), unique=True)
    user_id: Mapped[int] = mapped_column("userId", BigInteger)
    object_key: Mapped[str] = mapped_column("objectKey", String(512))
    status: Mapped[int] = mapped_column(Integer)
    retry_count: Mapped[int] = mapped_column("retryCount", Integer, default=0)
    last_error: Mapped[str | None] = mapped_column("lastError", String(512))
    create_time: Mapped[datetime] = mapped_column("createTime", DateTime, default=datetime.now)
    update_time: Mapped[datetime] = mapped_column("updateTime", DateTime, default=datetime.now)

"""``t_knowledge_document`` -- knowledge domain (Phase 2.4).

Mirrors ``model/entity/KnowledgeDocument.java``. ``id`` is ``AUTO_INCREMENT``
here (unlike ``t_user``/``t_diagnosis``/``t_news``, which are Snowflake).

``create_time``/``update_time`` are ``LocalDateTime`` in Java, so they go out
as ``"yyyy-MM-dd HH:mm:ss"`` via ``response.DateTimeStr`` -- same as the
``java.util.Date`` columns elsewhere, because ``JsonConfig`` registers the
formatter for both types.
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from web.db import Base


class KnowledgeDocument(Base):
    __tablename__ = "t_knowledge_document"

    id: Mapped[int] = mapped_column("id", BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column("userId", BigInteger, nullable=False)
    title: Mapped[str] = mapped_column("title", String(255), nullable=False)
    file_name: Mapped[str] = mapped_column("fileName", String(255), nullable=False)
    file_url: Mapped[str] = mapped_column("fileUrl", String(1024), nullable=False)
    file_size: Mapped[int | None] = mapped_column("fileSize", BigInteger)
    file_type: Mapped[str | None] = mapped_column("fileType", String(64))
    #: SHA-256 of the file bytes; backs duplicate-upload detection.
    content_hash: Mapped[str | None] = mapped_column("contentHash", String(64))
    chunk_count: Mapped[int | None] = mapped_column("chunkCount", Integer)
    #: 0=processing, 1=completed, 2=failed
    status: Mapped[int] = mapped_column("status", Integer, default=0)
    create_time: Mapped[datetime] = mapped_column("createTime", DateTime, nullable=False)
    update_time: Mapped[datetime] = mapped_column("updateTime", DateTime, nullable=False)
    is_delete: Mapped[int] = mapped_column("isDelete", Integer, nullable=False, default=0)

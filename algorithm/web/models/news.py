"""``t_news`` / ``t_paragraph`` / ``t_attachment`` -- news domain (Phase 2.3).

Mirrors ``model/entity/News.java``, ``Attachment.java`` and the two companion
tables in ``schema.sql``.

``content`` is a MySQL reserved word, so the column name is backticked on both
sides. ``status`` is likewise reserved. ``order`` in ``t_attachment`` is a
reserved word too and is mapped explicitly to the ``order_`` attribute.
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from web.db import Base


class News(Base):
    __tablename__ = "t_news"

    id: Mapped[int] = mapped_column("id", BigInteger, primary_key=True)
    title: Mapped[str] = mapped_column("title", String(255), nullable=False)
    user_id: Mapped[int] = mapped_column("userId", BigInteger, nullable=False)
    content: Mapped[str] = mapped_column("content", Text, nullable=False)
    #: Server-derived from ``content[:30]``; not settable via the update DTO.
    summary: Mapped[str | None] = mapped_column("summary", String(512))
    cover_img: Mapped[str] = mapped_column("coverImg", String(512), nullable=False)
    #: 0=draft / 1=published / 2=unpublished
    status: Mapped[int] = mapped_column("status", Integer, default=0)
    publish_time: Mapped[datetime] = mapped_column("publishTime", DateTime, nullable=False)
    edit_time: Mapped[datetime] = mapped_column("editTime", DateTime, nullable=False)

    paragraphs: Mapped[list["Paragraph"]] = relationship(
        back_populates="news", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="news", cascade="all, delete-orphan"
    )


class Paragraph(Base):
    __tablename__ = "t_paragraph"

    id: Mapped[int] = mapped_column("id", BigInteger, primary_key=True)
    news_id: Mapped[int] = mapped_column(
        "newsId", BigInteger, ForeignKey("t_news.id"), nullable=False
    )
    content: Mapped[str] = mapped_column("content", Text, nullable=False)

    news: Mapped[News] = relationship(back_populates="paragraphs")


class Attachment(Base):
    __tablename__ = "t_attachment"

    id: Mapped[int] = mapped_column("id", BigInteger, primary_key=True)
    news_id: Mapped[int] = mapped_column(
        "newsId", BigInteger, ForeignKey("t_news.id"), nullable=False
    )
    url: Mapped[str] = mapped_column("url", String(512), nullable=False)
    #: Paragraph ordering; ``order`` is a SQL reserved word.
    order_: Mapped[int] = mapped_column("order", SmallInteger, default=0)
    description: Mapped[str] = mapped_column("description", String(200), default="")

    news: Mapped[News] = relationship(back_populates="attachments")

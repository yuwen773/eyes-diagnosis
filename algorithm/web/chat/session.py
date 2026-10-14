"""Shared session ownership and message persistence for chat interactions."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from web.chat.models import ChatMessage, ChatSession
from web.response import BizError, ErrorCode


def owner(db: Session, session_id: str, user_id: int) -> ChatSession:
    row = db.scalar(select(ChatSession).where(ChatSession.session_id == session_id))
    if row is None or row.user_id != user_id or row.is_delete:
        raise BizError(ErrorCode.NO_AUTH_ERROR)
    return row


def save_message(db: Session, row: ChatSession, role: str, content: str) -> ChatMessage:
    message = ChatMessage(session_id=row.session_id, role=role, content=content)
    db.add(message)
    row.message_count += 1
    row.last_message = content[:500]
    row.updated_time = datetime.now()
    db.flush()
    return message

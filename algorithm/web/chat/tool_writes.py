"""Server-owned profile intent adapter; consent and the effect commit together."""

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import cast
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import BigInteger, CursorResult, DateTime, String, Text, UniqueConstraint, func, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from web.auth import LoginUser
from web.chat.session import owner
from web.db import Base
from web.models.user import User
from web.workflow.confirmation import canonical

PROFILE_TOOL = {"type": "function", "function": {"name": "propose_profile_update",
    "description": "提出修改本人简介，用户查看并批准前不会修改资料。",
    "parameters": {"type": "object", "properties": {"userProfile": {"type": "string", "maxLength": 512}},
        "required": ["userProfile"], "additionalProperties": False}}}
ADAPTER_VERSION = "profile-update-v1"


class ProfileIntent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    userProfile: str = Field(max_length=512)


class ToolDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotencyKey: str = Field(min_length=1, max_length=128)
    expectedContentDigest: str = Field(pattern=r"^[a-f0-9]{64}$")


class ToolConfirmation(Base):
    __tablename__ = "t_agent_tool_confirmation"
    __table_args__ = (UniqueConstraint("ownerUserId", "idempotencyKey"),)

    confirmation_id: Mapped[str] = mapped_column("confirmationId", String(64), primary_key=True)
    owner_user_id: Mapped[int] = mapped_column("ownerUserId", BigInteger)
    session_id: Mapped[str] = mapped_column("sessionId", String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column("idempotencyKey", String(128))
    content: Mapped[str] = mapped_column("contentSnapshot", Text)
    content_digest: Mapped[str] = mapped_column("contentDigest", String(64))
    status: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime)
    decided_at: Mapped[datetime | None] = mapped_column("decidedAt", DateTime)


def digest(value: dict) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def profile(db: Session, user: LoginUser) -> User:
    row = db.scalar(select(User).where(User.id == user.id).with_for_update()
                    .execution_options(populate_existing=True))
    if row is None or row.is_delete or user.userRole not in {"user", "admin", "doctor"} or row.user_role != user.userRole:
        raise HTTPException(403, "用户权限已变化")
    return row


def snapshot(row: User) -> dict:
    return {"userName": row.user_name, "userAvatar": row.user_avatar, "userProfile": row.user_profile,
        "role": row.user_role, "updatedAt": row.update_time.isoformat(), "editedAt": row.edit_time.isoformat()}


def view(db: Session, row: ToolConfirmation) -> dict:
    now = db.scalar(select(func.current_timestamp()))
    assert now is not None
    if row.status == "PENDING" and row.expires_at <= now:
        db.execute(update(ToolConfirmation).where(ToolConfirmation.confirmation_id == row.confirmation_id,
            ToolConfirmation.status == "PENDING", ToolConfirmation.expires_at <= now)
            .values(status="EXPIRED", decided_at=now).execution_options(synchronize_session=False))
        db.refresh(row)
    zone = timezone(timedelta(hours=8)) if db.get_bind().dialect.name == "mysql" else timezone.utc
    return {"confirmationId": row.confirmation_id, "sessionId": row.session_id,
        "operationType": "UPDATE_OWN_PROFILE", "idempotencyKey": row.idempotency_key,
        "contentDigest": row.content_digest, "content": json.loads(row.content), "status": row.status,
        "expiresAt": row.expires_at.replace(tzinfo=zone).isoformat()}


def propose(db: Session, user: LoginUser, session_id: str, key: str, raw: str,
            source: dict | None = None) -> dict:
    intent = ProfileIntent.model_validate_json(raw)
    owner(db, session_id, user.id)
    target = profile(db, user)
    source = source or {"kind": "internal", "name": "propose_profile_update", "version": ADAPTER_VERSION}
    existing = db.scalar(select(ToolConfirmation).where(ToolConfirmation.owner_user_id == user.id,
        ToolConfirmation.idempotency_key == key).with_for_update())
    if existing:
        old = json.loads(existing.content)
        if (existing.session_id != session_id or old["after"]["userProfile"] != intent.userProfile or old["source"] != source):
            raise HTTPException(409, "该操作幂等键已绑定其他内容或工具")
        return view(db, existing)
    content = {"targetUserId": str(user.id), "operationType": "UPDATE_OWN_PROFILE",
        "before": snapshot(target), "after": {"userProfile": intent.userProfile},
        "role": user.userRole, "source": source, "adapterVersion": ADAPTER_VERSION}
    now = db.scalar(select(func.current_timestamp()))
    assert now is not None
    row = ToolConfirmation(confirmation_id=uuid4().hex, owner_user_id=user.id, session_id=session_id,
        idempotency_key=key, content=canonical(content), content_digest=digest(content), status="PENDING",
        created_at=now, expires_at=now + timedelta(minutes=30))
    db.add(row)
    db.flush()
    return view(db, row)


def owned_confirmation(db: Session, confirmation_id: str, user: LoginUser) -> ToolConfirmation:
    row = db.scalar(select(ToolConfirmation).where(ToolConfirmation.confirmation_id == confirmation_id)
                    .with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, "确认请求不存在")
    if row.owner_user_id != user.id:
        raise HTTPException(403, "无权确认其他用户的操作")
    owner(db, row.session_id, user.id)
    return row


def decide(db: Session, row: ToolConfirmation, user: LoginUser, body: ToolDecision,
           approve: bool, source: dict) -> dict:
    if body.idempotencyKey != row.idempotency_key or body.expectedContentDigest != row.content_digest:
        raise HTTPException(409, "确认内容版本不匹配")
    current = view(db, row)
    status = "APPROVED" if approve else "REJECTED"
    if row.status == status:
        return current
    if row.status != "PENDING":
        db.commit()
        raise HTTPException(409, "确认已拒绝、过期或失效")
    content = json.loads(row.content)
    target = profile(db, user)
    if approve and (content["role"] != user.userRole or content["before"] != snapshot(target)
            or content["source"] != source or content["adapterVersion"] != ADAPTER_VERSION
            or digest(content) != row.content_digest):
        changed = cast(CursorResult, db.execute(update(ToolConfirmation).where(
            ToolConfirmation.confirmation_id == row.confirmation_id, ToolConfirmation.status == "PENDING")
            .values(status="INVALIDATED", decided_at=func.current_timestamp())
            .execution_options(synchronize_session=False))).rowcount
        db.refresh(row)
        if changed == 0 and row.status == "APPROVED":
            return view(db, row)  # A concurrent approval already committed this version.
        db.commit()
        raise HTTPException(409, "资料、角色或工具版本已变化，请重新提出操作")
    changed = cast(CursorResult, db.execute(update(ToolConfirmation).where(
        ToolConfirmation.confirmation_id == row.confirmation_id, ToolConfirmation.status == "PENDING",
        ToolConfirmation.expires_at > func.current_timestamp()).values(status=status, decided_at=func.current_timestamp())
        .execution_options(synchronize_session=False))).rowcount
    if changed != 1:
        raise HTTPException(409, "确认状态已变化")
    if approve:
        # The profile and confirmation receipt use the same MySQL transaction.
        # The conditional effect also fences databases without SELECT FOR UPDATE.
        changed = cast(CursorResult, db.execute(update(User).where(User.id == user.id,
            User.user_role == target.user_role, User.is_delete == 0,
            User.user_profile == target.user_profile, User.user_name == target.user_name,
            User.user_avatar == target.user_avatar, User.update_time == target.update_time,
            User.edit_time == target.edit_time).values(user_profile=content["after"]["userProfile"],
                update_time=func.current_timestamp()).execution_options(synchronize_session=False))).rowcount
        if changed != 1:
            raise HTTPException(409, "资料版本已变化")
    db.flush()
    db.refresh(row)
    return view(db, row)

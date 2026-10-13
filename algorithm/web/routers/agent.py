"""Existing Agent HTTP contracts, backed by MySQL session-local chat."""

import asyncio
import json
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from web.auth import LoginUser
from web.chat.attachments import AttachmentStore, attachment_store
from web.chat.model import stream_reply
from web.chat.models import ChatAttachment, ChatAudit, ChatMessage, ChatRun, ChatSession, LegacyUpload
from web.deps import get_db, login_user
from web.response import BaseResponse, BizError, ErrorCode, _java_date_string
from web.files import read_image_metadata

router = APIRouter(prefix="/agent", tags=["agent"])


class ChatRequest(BaseModel):
    message: str = Field(max_length=16000)
    threadId: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=64)
    imageUrls: list[str] = Field(default_factory=list, max_length=8)
    enabledMcpServers: list[str] | None = None
    disableMcpDefault: bool | None = None

    @field_validator("threadId", mode="before")
    @classmethod
    def default_thread(cls, value):
        return value if isinstance(value, str) and value.strip() else str(uuid4())


def owner(db: Session, session_id: str, user_id: int) -> ChatSession:
    row = db.scalar(select(ChatSession).where(ChatSession.session_id == session_id))
    if row is None or row.user_id != user_id or row.is_delete:
        raise BizError(ErrorCode.NO_AUTH_ERROR)
    return row


def messages(db: Session, session_id: str) -> list[ChatMessage]:
    return list(db.scalars(select(ChatMessage).where(ChatMessage.session_id == session_id)
                           .order_by(ChatMessage.id)))


def save_message(db: Session, row: ChatSession, role: str, content: str) -> ChatMessage:
    message = ChatMessage(session_id=row.session_id, role=role, content=content)
    db.add(message)
    row.message_count += 1
    row.last_message = content[:500]
    row.updated_time = datetime.now()
    db.flush()
    return message


def audit(db: Session, run: ChatRun, event: str) -> None:
    db.add(ChatAudit(run_id=run.id, session_id=run.session_id, user_id=run.user_id, event=event))


def finish(db: Session, run: ChatRun, status: str, error: str | None = None) -> None:
    run.status = status
    run.error_code = error
    run.active_session_id = None
    run.finished_time = datetime.now()
    audit(db, run, status)


def recover_expired(db: Session, session_id: str) -> None:
    for run in db.scalars(select(ChatRun).where(ChatRun.active_session_id == session_id,
                                               ChatRun.deadline < datetime.now()).with_for_update()):
        finish(db, run, "INTERRUPTED", "CHAT_STREAM_INTERRUPTED")
    db.flush()


def sse(data: object, event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return prefix + "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"


def message_images(db: Session, message_id: int) -> list[str]:
    return list(db.scalars(select(ChatAttachment.url).where(ChatAttachment.message_id == message_id,
                                                            ChatAttachment.is_delete == 0)))


def model_content(text: str, urls: list[str]):
    if not urls:
        return text
    return [{"type": "text", "text": text or "请查看本会话附件"},
            *[{"type": "image_url", "image_url": {"url": url}} for url in urls]]


def owned_attachment(db: Session, url: str, user_id: int, request: Request) -> ChatAttachment:
    row = db.scalar(select(ChatAttachment).where(ChatAttachment.url == url).with_for_update())
    if row is None:
        # Adopt only a persisted legacy upload verified in MySQL, never an arbitrary URL.
        host = request.app.state.config.cos_host.rstrip("/")
        prefix = host + "/"
        if host.startswith("https://") and url.startswith(prefix):
            legacy = db.scalar(select(LegacyUpload).where(LegacyUpload.object_key == url[len(prefix):],
                LegacyUpload.user_id == user_id, LegacyUpload.status.in_([2, 4])))
            if legacy is not None:
                row = ChatAttachment(id=str(uuid4()), user_id=user_id, url=url)
                db.add(row)
                db.flush()
    if row is None or row.user_id != user_id or row.is_delete:
        raise BizError(ErrorCode.NO_AUTH_ERROR, "无权使用该附件")
    return row


@router.post("/chat/stream")
async def chat_stream(body: ChatRequest, request: Request, db: Session = Depends(get_db),
                      user: LoginUser = Depends(login_user)):
    if not body.message.strip() and not body.imageUrls:
        raise BizError(ErrorCode.PARAMS_ERROR, "消息不能为空")
    if body.enabledMcpServers:
        raise BizError(ErrorCode.OPERATION_ERROR, "MCP 工具迁移尚未启用")
    row = db.scalar(select(ChatSession).where(ChatSession.session_id == body.threadId).with_for_update())
    if row is None:
        row = ChatSession(session_id=body.threadId, user_id=user.id, title=body.message[:50] or "图片会话")
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            row = owner(db, body.threadId, user.id)
    else:
        owner(db, body.threadId, user.id)
    recover_expired(db, body.threadId)
    if db.scalar(select(ChatRun.id).where(ChatRun.active_session_id == body.threadId)):
        raise BizError(ErrorCode.OPERATION_ERROR, "本会话仍在回答，请稍后重试")
    attachments = []
    for url in set(body.imageUrls):
        attachment = owned_attachment(db, url, user.id, request)
        if (
                attachment.session_id is not None and attachment.session_id != body.threadId):
            raise BizError(ErrorCode.NO_AUTH_ERROR, "无权使用该附件")
        # An attachment belongs to its first message; history carries it to later rounds.
        if attachment.message_id is not None:
            raise BizError(ErrorCode.PARAMS_ERROR, "附件已经发送，请勿重复附加")
        attachments.append(attachment)
    history = [{"role": m.role.lower(), "content": model_content(m.content, message_images(db, m.id))}
               for m in messages(db, body.threadId) if m.sub_type == "text" and m.role in {"USER", "ASSISTANT"}]
    saved = save_message(db, row, "USER", body.message)
    for attachment in attachments:
        attachment.session_id = body.threadId
        attachment.message_id = saved.id
    run = ChatRun(id=str(uuid4()), session_id=body.threadId, active_session_id=body.threadId,
                  user_id=user.id, message_id=saved.id, deadline=datetime.now() + timedelta(seconds=130))
    db.add(run)
    audit(db, run, "STARTED")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise BizError(ErrorCode.OPERATION_ERROR, "本会话仍在回答，请稍后重试") from None
    context = [{"role": "system", "content": (
        "你是眼科辅助系统的普通聊天助手。只使用当前会话提供的事实；不要导入其他会话的症状。"
        "普通问答不启动诊断。图片分析请引导用户使用受控诊断上传入口。"
        "不得声称已运行诊断、已保存正式诊断、已复核或已执行任何业务操作。")},
        *history, {"role": "user", "content": model_content(body.message, body.imageUrls)}]

    async def generate():
        chunks: list[str] = []
        try:
            async with asyncio.timeout(120):
                async for delta in stream_reply(request.app.state.chat_client, request.app.state.config, context):
                    chunks.append(delta)
                    if sum(map(len, chunks)) > 32000:
                        raise RuntimeError("CHAT_RESPONSE_TOO_LARGE")
                    yield sse({"messageType": "assistant", "content": delta})
            if not "".join(chunks).strip():
                raise RuntimeError("CHAT_MODEL_EMPTY")
            # Re-read after the external call; no transaction is held across it.
            db.refresh(run)
            row = owner(db, body.threadId, user.id)
            if run.status != "RUNNING" or run.deadline < datetime.now():
                raise RuntimeError("CHAT_STREAM_INTERRUPTED")
            save_message(db, row, "ASSISTANT", "".join(chunks))
            finish(db, run, "COMPLETED")
            db.commit()
            yield sse("", "done")
        except asyncio.CancelledError:
            db.rollback()
            db.refresh(run)
            if run.status == "RUNNING":
                finish(db, run, "INTERRUPTED", "CHAT_STREAM_INTERRUPTED")
                db.commit()
            raise
        except Exception:
            db.rollback()
            db.refresh(run)
            if run.status == "RUNNING":
                finish(db, run, "FAILED", "CHAT_MODEL_FAILED")
                db.commit()
            yield sse("回答未完成，请稍后重试", "error")

    return StreamingResponse(generate(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no", "X-Session-Id": body.threadId})


@router.get("/history/{thread_id}")
def history(thread_id: str, beforeId: int | None = None, limit: int = 40,
            db: Session = Depends(get_db), user: LoginUser = Depends(login_user)):
    owner(db, thread_id, user.id)
    recover_expired(db, thread_id)
    limit = max(1, min(limit, 100))
    query = select(ChatMessage).where(ChatMessage.session_id == thread_id)
    if beforeId is not None:
        query = query.where(ChatMessage.id < beforeId)
    rows = list(db.scalars(query.order_by(ChatMessage.id.desc()).limit(limit + 1)))
    more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    runs = list(db.scalars(select(ChatRun).where(ChatRun.session_id == thread_id).order_by(ChatRun.created_time)))
    return BaseResponse.success({"messages": [{"id": str(m.id), "role": m.role,
        "subType": m.sub_type, "content": m.content, "isSummary": bool(m.is_summary),
        "createdTime": _java_date_string(m.created_time), "imageUrls": message_images(db, m.id)} for m in rows],
        "hasMore": more, "nextCursor": str(rows[0].id) if more else None,
        "executions": [{"id": r.id, "status": r.status, "errorCode": r.error_code,
                        "messageId": str(r.message_id), "auditEvents": list(db.scalars(
                            select(ChatAudit.event).where(ChatAudit.run_id == r.id).order_by(ChatAudit.id)))}
                       for r in runs]})


@router.get("/sessions")
def sessions(beforeId: int | None = None, limit: int = 20, db: Session = Depends(get_db),
             user: LoginUser = Depends(login_user)):
    query = select(ChatSession).where(ChatSession.user_id == user.id, ChatSession.is_delete == 0)
    if beforeId is not None:
        query = query.where(ChatSession.id < beforeId)
    rows = db.scalars(query.order_by(ChatSession.pinned.desc(), ChatSession.pin_time.asc(),
                                    ChatSession.updated_time.desc()).limit(max(1, min(limit, 100))))
    return BaseResponse.success([{"sessionId": r.session_id, "title": r.title,
        "lastMessage": r.last_message, "messageCount": r.message_count,
        "summaryContent": r.summary_content, "createdTime": _java_date_string(r.created_time),
        "updatedTime": _java_date_string(r.updated_time), "isPinned": bool(r.pinned)} for r in rows])


class SessionBatch(BaseModel):
    sessionIds: list[str] = Field(min_length=1, max_length=100)


@router.delete("/sessions/batch")
def delete_batch(body: SessionBatch, db: Session = Depends(get_db), user: LoginUser = Depends(login_user)):
    rows = [owner(db, sid, user.id) for sid in set(body.sessionIds)]
    for row in rows:
        row.is_delete = 1
        row.updated_time = datetime.now()
    return BaseResponse.success(len(rows))


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db), user: LoginUser = Depends(login_user)):
    row = owner(db, session_id, user.id)
    row.is_delete = 1
    row.updated_time = datetime.now()
    return BaseResponse.success(True)


class TitleRequest(BaseModel):
    title: str = Field(min_length=1, max_length=50)


@router.put("/sessions/{session_id}/title")
def update_title(session_id: str, body: TitleRequest, db: Session = Depends(get_db),
                 user: LoginUser = Depends(login_user)):
    row = owner(db, session_id, user.id)
    if not body.title.strip():
        raise BizError(ErrorCode.PARAMS_ERROR)
    row.title = body.title
    row.updated_time = datetime.now()
    return BaseResponse.success(True)


class PinRequest(BaseModel):
    pinned: bool


@router.put("/sessions/{session_id}/pin")
def update_pin(session_id: str, body: PinRequest, db: Session = Depends(get_db),
               user: LoginUser = Depends(login_user)):
    row = owner(db, session_id, user.id)
    row.pinned = int(body.pinned)
    row.pin_time = datetime.now() if body.pinned else None
    return BaseResponse.success(True)


class GenerateTitleRequest(BaseModel):
    firstMessage: str = Field(min_length=1, max_length=16000)


@router.post("/sessions/{session_id}/generate-title")
async def generate_title(session_id: str, body: GenerateTitleRequest, request: Request,
                         db: Session = Depends(get_db), user: LoginUser = Depends(login_user)):
    owner(db, session_id, user.id)
    db.commit()
    try:
        async with asyncio.timeout(120):
            parts = [part async for part in stream_reply(request.app.state.chat_client,
                request.app.state.config, [{"role": "system", "content": "为用户的消息生成50字以内的会话标题，只输出标题。"},
                                           {"role": "user", "content": body.firstMessage}])]
        title = "".join(parts).strip()[:50]
        if not title:
            raise ValueError("empty title")
    except Exception:
        raise BizError(ErrorCode.OPERATION_ERROR, "标题生成失败") from None
    row = owner(db, session_id, user.id)
    row.title = title
    row.updated_time = datetime.now()
    return BaseResponse.success(True)


@router.get("/history/{session_id}/export")
def export_session(session_id: str, format: str = "markdown", db: Session = Depends(get_db),
                   user: LoginUser = Depends(login_user)):
    row = owner(db, session_id, user.id)
    rows = messages(db, session_id)
    if format.lower() == "json":
        result = json.dumps({"sessionId": session_id, "title": row.title,
            "createdAt": _java_date_string(row.created_time), "messages": [{"role": m.role,
                "content": m.content, "time": _java_date_string(m.created_time),
                "imageUrls": message_images(db, m.id)} for m in rows]}, ensure_ascii=False)
    else:
        result = f"# {row.title}\n\n会话 ID: {session_id}\n\n" + "\n\n".join(
            f"## {m.role}\n\n{m.content}" + "".join(f"\n\n![附件]({url})" for url in message_images(db, m.id))
            for m in rows)
    return BaseResponse.success(result)


@router.post("/image/upload")
async def upload_image(file: UploadFile, db: Session = Depends(get_db), user: LoginUser = Depends(login_user),
                       store: AttachmentStore = Depends(attachment_store)):
    data = await file.read(2 * 1024 * 1024 + 1)
    if not data or len(data) > 2 * 1024 * 1024 or file.content_type not in {"image/jpeg", "image/png"}:
        raise BizError(ErrorCode.PARAMS_ERROR, "仅支持不超过 2MB 的 JPEG、PNG 图片")
    try:
        width, height, kind = read_image_metadata(data)
        if width <= 0 or height <= 0 or kind not in {"png", "jpeg"}:
            raise ValueError("invalid image")
    except Exception:
        raise BizError(ErrorCode.PARAMS_ERROR, "无法解码为图像") from None
    db.commit()
    try:
        url = await store.put(data, "image.png" if kind == "png" else "image.jpg", user.id)
    except Exception:
        raise BizError(ErrorCode.SYSTEM_ERROR, "图片上传失败") from None
    db.add(ChatAttachment(id=str(uuid4()), user_id=user.id, url=url))
    return BaseResponse.success(url)


class DeleteImageRequest(BaseModel):
    url: str = Field(max_length=512)


@router.post("/image/upload/delete")
async def delete_image(body: DeleteImageRequest, db: Session = Depends(get_db),
                       user: LoginUser = Depends(login_user), store: AttachmentStore = Depends(attachment_store)):
    row = db.scalar(select(ChatAttachment).where(ChatAttachment.url == body.url).with_for_update())
    if row is None or row.user_id != user.id:
        raise BizError(ErrorCode.NO_AUTH_ERROR)
    # The legacy UI cleans up after sending. Once bound, history owns the object.
    if row.session_id is not None or row.is_delete:
        return BaseResponse.success(True)
    row.is_delete = 1
    db.commit()
    try:
        await store.delete(row.url)
    except Exception:
        row.is_delete = 0
        db.commit()
        raise BizError(ErrorCode.OPERATION_ERROR, "附件清理失败") from None
    return BaseResponse.success(True)

"""Existing Agent HTTP contracts, backed by MySQL session-local chat."""

import asyncio
import json
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from web.auth import LoginUser
from web.chat.attachments import AttachmentStore, attachment_store
from web.chat.model import stream_reply
from web.chat.mcp import McpTools, ToolError, select_servers
from web.chat.history import query_history
from web.chat.models import ChatAttachment, ChatAudit, ChatMessage, ChatRun, ChatSession, ChatWorkflow, LegacyUpload
from web.chat.session import owner, save_message
from web.chat import supplement
from web.chat import tool_writes
from web.schemas.supplement import SupplementReply, SupplementRequest, SupplementView
from web.deps import get_db, login_user
from web.response import BaseResponse, BizError, ErrorCode, _java_date_string
from web.files import read_image_metadata
from web.events import sse
from web.workflow.models import UploadInput
from web.workflow.service import create_or_get, owned_workflow, workflow_view

router = APIRouter(prefix="/agent", tags=["agent"])


class DiagnosisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workflowId: str | None = Field(default=None, min_length=1, max_length=64)
    imageUrl: str | None = Field(default=None, min_length=1, max_length=512)
    idempotencyKey: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")

    @model_validator(mode="after")
    def one_operation(self):
        if self.workflowId is not None:
            if self.imageUrl is not None or self.idempotencyKey is not None:
                raise ValueError("继续任务不能同时创建新任务")
        elif self.imageUrl is None or self.idempotencyKey is None:
            raise ValueError("创建任务需要附件和幂等键")
        return self


class ChatRequest(BaseModel):
    message: str = Field(max_length=16000)
    threadId: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=64)
    imageUrls: list[str] = Field(default_factory=list, max_length=8)
    enabledMcpServers: list[str] | None = Field(default=None, max_length=8)
    disableMcpDefault: bool | None = None
    diagnosis: DiagnosisRequest | None = None
    supplement: SupplementRequest | None = None

    @model_validator(mode="after")
    def separate_interactions(self):
        if self.supplement is not None and (self.diagnosis is not None or self.imageUrls):
            raise ValueError("补充说明不能同时创建诊断或发送附件")
        return self

    @field_validator("threadId", mode="before")
    @classmethod
    def default_thread(cls, value):
        return value if isinstance(value, str) and value.strip() else str(uuid4())


def messages(db: Session, session_id: str) -> list[ChatMessage]:
    return list(db.scalars(select(ChatMessage).where(ChatMessage.session_id == session_id)
                           .order_by(ChatMessage.id)))


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
    if not body.message.strip() and not body.imageUrls and body.diagnosis is None and body.supplement is None:
        raise BizError(ErrorCode.PARAMS_ERROR, "消息不能为空")
    servers = (select_servers(db, user.id, body.enabledMcpServers, body.disableMcpDefault, request.app.state.config)
               if body.diagnosis is None and body.supplement is None else [])
    row = db.scalar(select(ChatSession).where(ChatSession.session_id == body.threadId).with_for_update())
    if row is None:
        row = ChatSession(session_id=body.threadId, user_id=user.id, title=body.message[:50] or "图片会话")
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            row = db.scalar(select(ChatSession).where(ChatSession.session_id == body.threadId).with_for_update())
            owner(db, body.threadId, user.id)
    else:
        owner(db, body.threadId, user.id)
    assert row is not None
    recover_expired(db, body.threadId)
    if db.scalar(select(ChatRun.id).where(ChatRun.active_session_id == body.threadId)):
        raise BizError(ErrorCode.OPERATION_ERROR, "本会话仍在回答，请稍后重试")
    if body.supplement is not None:
        if len(body.message) > 4000:
            raise BizError(ErrorCode.PARAMS_ERROR, "补充请求说明不超过4000字")
        wait = supplement.request_wait(db, row, body.supplement.workflowId,
                                       body.supplement.idempotencyKey, body.message)
        payload = supplement.view(wait)
        db.commit()
        return StreamingResponse(iter([sse(payload, "supplement"), sse("", "done")]),
            media_type="text/event-stream", headers={"Cache-Control": "no-cache",
                "X-Accel-Buffering": "no", "X-Session-Id": body.threadId})
    if body.diagnosis is not None:
        try:
            return diagnostic_stream(body, row, request, db, user)
        except HTTPException as exc:
            code = ErrorCode.NO_AUTH_ERROR if exc.status_code == 403 else ErrorCode.OPERATION_ERROR
            raise BizError(code, str(exc.detail)) from None
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
               for m in messages(db, body.threadId) if m.sub_type in {None, "text"} and m.role in {"USER", "ASSISTANT"}]
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
        "普通问答不启动诊断。图片分析请引导用户选择聊天中的受控图片诊断选项或上传入口。"
        "不得声称已运行诊断、已保存正式诊断、已复核或已执行任何业务操作。"
        "用户按需查询本人已保存的既往诊断时，调用 query_diagnosis_history，只读结果由系统直接展示。"
        "不得猜测历史记录；历史症状、结论不是本次事实，不能写入本次任务或要求无必要的保存确认。")},
        *history, {"role": "user", "content": model_content(body.message, body.imageUrls)}]

    async def generate():
        chunks: list[str] = []
        history_queried = False
        mcp_queried = False
        history_bind = db.get_bind()

        async def read_history(arguments: str) -> str:
            nonlocal history_queried
            history_queried = True

            def read() -> str:
                # A cancelled stream must never share its session with the reader thread.
                with Session(bind=history_bind) as history_db:
                    return query_history(history_db, user.id, arguments)

            return await asyncio.to_thread(read)

        try:
            access = McpTools(history_bind, user.id, servers, request.app.state.config,
                              session_id=body.threadId,
                              transport=getattr(request.app.state, "mcp_transport", None))

            async def call_mcp(name: str, arguments: str) -> str:
                nonlocal mcp_queried
                mcp_queried = True
                if name == "propose_profile_update":
                    source = None
                elif access.is_write(name):
                    source = access.validate_write(name, arguments)
                else:
                    return await access.call(name, arguments)
                # An LLM tool call creates only a consent intent, never the effect.
                with Session(bind=history_bind) as consent_db:
                    tool_writes.propose(consent_db, user, body.threadId, run.id, arguments, source)
                    consent_db.commit()
                return "待用户确认，尚未修改资料。请查看聊天中的变更预览，批准或拒绝本次修改。"

            async with asyncio.timeout(120), access.connect():
                async for delta in stream_reply(request.app.state.chat_client, request.app.state.config, context,
                        history_tool=read_history, tools=[*access.tools, tool_writes.PROFILE_TOOL], invoke_tool=call_mcp):
                    if isinstance(delta, dict):
                        yield sse({**delta, "sessionId": body.threadId, "runId": run.id}, "tool")
                    else:
                        chunks.append(delta)
                        if sum(map(len, chunks)) > 32000:
                            raise RuntimeError("CHAT_RESPONSE_TOO_LARGE")
                        yield sse({"messageType": "assistant", "content": delta,
                                   "sessionId": body.threadId, "runId": run.id})
            if not "".join(chunks).strip():
                raise RuntimeError("CHAT_MODEL_EMPTY")
            # Re-read after the external call; no transaction is held across it.
            db.refresh(run)
            row = owner(db, body.threadId, user.id)
            if run.status != "RUNNING" or run.deadline < datetime.now():
                raise RuntimeError("CHAT_STREAM_INTERRUPTED")
            saved_reply = save_message(db, row, "ASSISTANT", "".join(chunks))
            if history_queried:
                # Display/export the source, but don't promote it into ordinary case memory.
                saved_reply.sub_type = "diagnosis_history"
            elif mcp_queried:
                saved_reply.sub_type = "mcp_tool"
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
        except Exception as exc:
            db.rollback()
            db.refresh(run)
            if run.status == "RUNNING":
                finish(db, run, "FAILED", str(exc) if isinstance(exc, ToolError) else "CHAT_MODEL_FAILED")
                db.commit()
            if isinstance(exc, ToolError):
                yield sse({"status": "FAILED", "code": str(exc),
                           "sessionId": body.threadId, "runId": run.id}, "tool")
            yield sse("回答未完成，请稍后重试", "error")

    return StreamingResponse(generate(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no", "X-Session-Id": body.threadId})


def diagnostic_stream(body: ChatRequest, row: ChatSession, request: Request, db: Session, user: LoginUser):
    action = body.diagnosis
    assert action is not None
    if body.imageUrls or len(body.message) > 4000:
        raise HTTPException(422, "诊断操作请使用单个附件，说明不超过4000字")
    attachment = None
    if action.workflowId is not None:
        workflow = owned_workflow(db, action.workflowId, int(user.id))
    else:
        assert action.imageUrl is not None and action.idempotencyKey is not None
        attachment = owned_attachment(db, action.imageUrl, user.id, request)
        if attachment.session_id is not None and attachment.session_id != body.threadId:
            raise BizError(ErrorCode.NO_AUTH_ERROR, "无权使用该附件")
        if attachment.image_bytes is None:
            raise HTTPException(409, "旧附件没有持久图片输入，请重新上传后诊断")
        workflow = create_or_get(db, int(user.id), attachment.image_bytes, action.idempotencyKey, body.message)
    binding = db.get(ChatWorkflow, (body.threadId, workflow.workflow_id))
    if binding is None:
        saved = save_message(db, row, "USER", body.message or "查看图片诊断任务")
        saved.sub_type = "workflow"
        if attachment is not None and attachment.message_id is None:
            attachment.session_id = body.threadId
            attachment.message_id = saved.id
        db.add(ChatWorkflow(session_id=body.threadId, workflow_id=workflow.workflow_id,
                            message_id=saved.id, attachment_id=attachment.id if attachment else None))
    db.commit()
    upload = db.get(UploadInput, workflow.workflow_id)
    assert upload is not None
    payload = {"sessionId": body.threadId, "workflow": workflow_view(workflow, upload, db)}
    return StreamingResponse(iter([sse(payload, "workflow"), sse("", "done")]),
        media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                               "X-Session-Id": body.threadId})


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
    workflows = []
    for binding in db.scalars(select(ChatWorkflow).where(ChatWorkflow.session_id == thread_id)
                             .order_by(ChatWorkflow.created_time, ChatWorkflow.workflow_id)):
        workflow = owned_workflow(db, binding.workflow_id, int(user.id))
        upload = db.get(UploadInput, binding.workflow_id)
        assert upload is not None
        workflows.append(workflow_view(workflow, upload, db))
    return BaseResponse.success({"workflows": workflows, "supplements": supplement.history(db, thread_id),
        "messages": [{"id": str(m.id), "role": m.role,
        "subType": m.sub_type, "content": m.content, "isSummary": bool(m.is_summary),
        "createdTime": _java_date_string(m.created_time), "imageUrls": message_images(db, m.id)} for m in rows],
        "hasMore": more, "nextCursor": str(rows[0].id) if more else None,
        "executions": [{"id": r.id, "status": r.status, "errorCode": r.error_code,
                        "messageId": str(r.message_id), "auditEvents": list(db.scalars(
                            select(ChatAudit.event).where(ChatAudit.run_id == r.id).order_by(ChatAudit.id)))}
                       for r in runs]})


@router.get("/supplements/{request_id}", response_model=BaseResponse[SupplementView])
def get_supplement(request_id: str, db: Session = Depends(get_db), user: LoginUser = Depends(login_user)):
    wait = db.get(supplement.Supplement, request_id)
    if wait is None or wait.user_id != user.id:
        raise BizError(ErrorCode.NO_AUTH_ERROR)
    owner(db, wait.session_id, user.id)
    return BaseResponse.success(supplement.view(wait))


@router.post("/supplements/{request_id}/reply", response_model=BaseResponse[SupplementView])
def reply_supplement(request_id: str, body: SupplementReply, db: Session = Depends(get_db),
                     user: LoginUser = Depends(login_user)):
    session = db.scalar(select(ChatSession).where(ChatSession.session_id == body.sessionId)
                        .with_for_update().execution_options(populate_existing=True))
    owner(db, body.sessionId, user.id)
    wait = db.scalar(select(supplement.Supplement).where(supplement.Supplement.request_id == request_id)
                     .with_for_update().execution_options(populate_existing=True))
    if (wait is None or wait.user_id != user.id or wait.session_id != body.sessionId or
            wait.workflow_id != body.workflowId or db.get(ChatWorkflow, (body.sessionId, body.workflowId)) is None):
        raise BizError(ErrorCode.NO_AUTH_ERROR)
    recover_expired(db, body.sessionId)
    if db.scalar(select(ChatRun.id).where(ChatRun.active_session_id == body.sessionId)):
        raise BizError(ErrorCode.OPERATION_ERROR, "本会话仍在回答，请稍后重试")
    assert session is not None
    answered = supplement.resume(db, session, wait, int(body.expectedVersion), body.text)
    payload = supplement.view(answered)
    db.commit()
    return BaseResponse.success(payload)


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
    db.add(ChatAttachment(id=str(uuid4()), user_id=user.id, url=url, image_bytes=data))
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

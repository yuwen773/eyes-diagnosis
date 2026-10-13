"""``/knowledge`` routes -- all 3 endpoints in ``KnowledgeBaseController.java``.

This domain moves the Chroma **write** side of the RAG pipeline to Python. Java
keeps the read side (``DocumentSearchTool``), so this module is where the two
stacks meet: see the cross-language contract table in ``web/knowledge.py``.

Three behaviours worth knowing:

* **Indexing is asynchronous.** Issue 07 validates/extracts before storage so
  parse and empty-file failures reach the caller. ``/upload``
  returns document ids while ``status`` is still 0 (processing), then flips to
  1 (completed) or 2 (failed). The frontend polls ``/list/page``. Reproduced with
  a FastAPI background task, which runs after the response is sent -- and with
  its **own** database session, since the request-scoped one is closed by then.
* **Failures are per-file, not per-request.** One bad file in a batch is
  collected into ``failedFiles``; the request only fails if *every* file failed
  (``OPERATION_ERROR`` with the concatenated reasons). A partial success returns
  HTTP 200 with the ids that worked. Issue 07 also reports rejected files in
  ``msg`` without changing the list-of-ids data contract.
* **Delete cleans up in an order that tolerates partial failure**: vectors, then
  COS object, then the row. Each step's exception is caught and logged, so a
  Chroma outage still deletes the database row -- at the cost of leaving
  orphaned vectors behind.
"""

import logging
import uuid
from datetime import datetime
from functools import partial
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from web.auth import ADMIN_ROLE, LoginUser, require_role
from web.constant import DEFAULT_ROLE
from web.deps import db_session, get_config, get_db
from web.knowledge import (
    DocumentParseError,
    UnsupportedFormat,
    build_chunks,
    chunk_ids,
    file_content_hash,
    merge_paragraphs,
    parse,
    resolve_file_type,
)
from web.models.knowledge import KnowledgeDocument
from web.response import BaseResponse, BizError, ErrorCode, PageResult
from web.schemas.knowledge import (
    DeleteRequest,
    KnowledgeDocumentVO,
    KnowledgePageQuery,
    GovernanceUpdate,
    PrivateSearchRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

#: ``KnowledgeBaseServiceImpl:101`` -- raised when the whole batch fails.
ALL_FILES_FAILED_PREFIX = "全部文件上传失败: "
#: ``:49`` -- empty batch.
NO_FILES_SELECTED = "请选择至少一个文件"
#: ``:135`` -- already soft-deleted.
ALREADY_DELETED = "文档已被删除"

#: ``status`` values, ``KnowledgeDocument.java:20``.
STATUS_PROCESSING = 0
STATUS_COMPLETED = 1
STATUS_FAILED = 2

require_user = partial(require_role, DEFAULT_ROLE)
require_admin = partial(require_role, ADMIN_ROLE)


@router.get("/admin/catalog", summary="参考资料受控编码目录")
def evidence_catalog(user: LoginUser = Depends(require_admin)):
    from web.evidence import DISEASE_TERMS, TOPIC_TERMS

    return BaseResponse.success({"diseaseCodes": DISEASE_TERMS, "topicCodes": TOPIC_TERMS})


@router.post("/admin/documents", summary="管理员查询参考资料")
def admin_documents(body: KnowledgePageQuery, db: Session = Depends(get_db),
                    user: LoginUser = Depends(require_admin)):
    query = select(KnowledgeDocument).where(KnowledgeDocument.is_delete == 0)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(KnowledgeDocument.create_time.desc()).limit(body.pageSize)
                      .offset((body.current - 1) * body.pageSize)).all()
    return BaseResponse.success(PageResult.of([
        KnowledgeDocumentVO.model_validate(row, from_attributes=True) for row in rows
    ], total or 0, body.pageSize, body.current))


@router.post("/search", summary="只检索本人授权资料，独立于正式诊断证据")
def search_private_documents(body: PrivateSearchRequest, db: Session = Depends(get_db),
                             user: LoginUser = Depends(require_user)):
    from web.evidence import private_search
    from web.vectorstore import VectorStoreUnavailable

    try:
        return BaseResponse.success(private_search(db, get_config(), int(user.id), body.query))
    except VectorStoreUnavailable as exc:
        raise BizError(ErrorCode.OPERATION_ERROR, "私人资料检索暂不可用") from exc


@router.patch("/admin/documents/{document_id}", summary="确认参考资料审核与受控元数据")
def govern_document(document_id: int, body: GovernanceUpdate, db: Session = Depends(get_db),
                    user: LoginUser = Depends(require_admin)):
    document = db.scalar(select(KnowledgeDocument).where(
        KnowledgeDocument.id == document_id, KnowledgeDocument.is_delete == 0).with_for_update())
    if document is None:
        raise HTTPException(404, "资料不存在")
    if document.governance_version != body.expectedVersion:
        raise HTTPException(409, "资料已更新，请刷新后重新确认")
    if body.reviewStatus == "APPROVED" and (document.status != STATUS_COMPLETED or
            not body.diseaseCodes or not body.topicCodes):
        raise HTTPException(422, "审核通过需要已完成索引且具有疾病和主题编码")
    document.visibility = body.visibility
    document.review_status = body.reviewStatus
    document.disease_codes = body.diseaseCodes
    document.topic_codes = body.topicCodes
    document.governance_version += 1
    document.reviewed_by = int(user.id)
    document.reviewed_at = document.update_time = datetime.now()
    db.flush()
    return BaseResponse.success(KnowledgeDocumentVO.model_validate(document, from_attributes=True))


# ---------------------------------------------------------------------------
# POST /knowledge/upload
# ---------------------------------------------------------------------------
@router.post("/upload", summary="上传知识库文档")
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: Annotated[list[UploadFile], File(...)],
    title: Annotated[str | None, Form()] = None,
    _user: LoginUser = Depends(require_user),
):
    """``KnowledgeBaseServiceImpl.uploadDocument``.

    Multipart field is ``files`` -- **plural**, unlike every other upload in the
    project, which uses ``file``. Binding ``file`` here would silently accept
    nothing.

    Returns the ids that were stored. Per-file failures are in ``msg``; the
    ``data`` list remains compatible with the frontend client.
    """
    if not files:
        raise BizError(ErrorCode.PARAMS_ERROR, NO_FILES_SELECTED)

    owner_id = int(_user.id)
    now = datetime.now()
    created: list[int] = []
    failures: list[str] = []
    pending: list[tuple[int, str, str, str]] = []

    for upload in files:
        filename = upload.filename
        try:
            file_type = resolve_file_type(filename)
        except ValueError as exc:
            failures.append(f"{filename}（{exc}）")
            continue

        data = await upload.read()
        content_hash = file_content_hash(data)

        if _already_uploaded(owner_id, content_hash):
            failures.append(f"{filename}（文档已存在）")
            continue

        try:
            paragraphs = await run_in_threadpool(parse, data, file_type)
        except (DocumentParseError, UnsupportedFormat) as exc:
            failures.append(f"{filename}（{exc}）")
            continue
        if not paragraphs:
            failures.append(f"{filename}（文档内容为空）")
            continue
        raw_text = merge_paragraphs(paragraphs)

        stored_name = f"{uuid.uuid4()}_{filename}"
        try:
            _put_object(stored_name, data)
        except Exception:  # noqa: BLE001 - Java catches IOException per file
            logger.exception("knowledge upload failed: %s", filename)
            failures.append(f"{filename}（上传失败）")
            continue

        document = KnowledgeDocument(
            user_id=owner_id,
            title=title if title is not None else filename,
            file_name=filename,
            file_url=stored_name,
            file_size=len(data),
            file_type=file_type,
            content_hash=content_hash,
            status=STATUS_PROCESSING,
            create_time=now,
            update_time=now,
            is_delete=0,
        )
        session = db_session()
        try:
            session.add(document)
            session.commit()
            session.refresh(document)
        except Exception:  # noqa: BLE001
            session.rollback()
            logger.exception("knowledge row insert failed: %s", filename)
            failures.append(f"{filename}（上传失败）")
            continue
        finally:
            session.close()

        created.append(document.id)
        pending.append((document.id, raw_text, file_type, document.title))

    if not created and failures:
        raise BizError(
            ErrorCode.OPERATION_ERROR, ALL_FILES_FAILED_PREFIX + ", ".join(failures)
        )
    if failures:
        # Preserve successes; the response also carries per-file reasons.
        logger.warning("knowledge upload partially failed: %s", failures)

    # ETL after the response, each document with its own session.
    for doc_id, raw_text, file_type, doc_title in pending:
        background_tasks.add_task(process_document, doc_id, raw_text, file_type, doc_title)

    # `List<Long>` -- Jackson's ToStringSerializer applies inside the list too.
    response = BaseResponse.success([str(doc_id) for doc_id in created])
    if failures:
        response.msg = "部分文件上传失败: " + ", ".join(failures)
    return response


def _already_uploaded(owner_id: int, content_hash: str) -> bool:
    """Duplicate check -- ``uploadDocument:69-75``, scoped to the owner.

    Per-user, not global: two doctors uploading the same guideline should each
    get their own copy, because retrieval filters on ``ownerUserId``.
    """
    session = db_session()
    try:
        found = session.execute(
            select(KnowledgeDocument.id)
            .where(KnowledgeDocument.user_id == owner_id)
            .where(KnowledgeDocument.content_hash == content_hash)
            .where(KnowledgeDocument.is_delete == 0)
            .limit(1)
        ).first()
        return found is not None
    finally:
        session.close()


def _put_object(key: str, data: bytes) -> None:
    """``CosManager.putObject(key, file)``.

    Key is the bare ``{uuid}_{originalName}`` with **no folder prefix** -- the
    picture uploader's ``public/{userId}`` convention does not apply here, and
    ``t_knowledge_document.fileUrl`` stores this key, not a URL. That is what
    ``deleteObject`` is later called with.
    """
    config = get_config()
    import qcloud_cos

    client = qcloud_cos.CosConfig(
        Region=config.cos_region, SecretId=config.cos_secret_id, SecretKey=config.cos_secret_key
    )
    qcloud_cos.COSClient(client).put_object(Bucket=config.cos_bucket, Key=key, Body=data)


def process_document(doc_id: int, raw_text: str, file_type: str, title: str) -> None:
    """``DocumentProcessingService.processDocument`` -- chunk, embed, load.

    Text was validated before upload. Synchronous here and run as a background task. Java uses ``@Async`` on a
    dedicated executor; a FastAPI background task runs on the event loop's
    threadpool after the response, which has the same observable property: the
    upload already returned.

    Every failure path ends at ``status = 2`` and never re-raises -- this runs
    after the response, so an exception here would be invisible to the client
    and the document would sit at 0 forever.
    """
    from web.vectorstore import ChromaWriter, DashScopeEmbedder, VectorStoreUnavailable

    try:
        session = db_session()
        try:
            document = session.get(KnowledgeDocument, doc_id)
            if document is None:
                raise ValueError(f"文档不存在: docId={doc_id}")
            owner_id = int(document.user_id)
            file_url = document.file_url
        finally:
            session.close()

        payloads = build_chunks(
            # Java passes the temp file's absolute path as `source`, which puts
            # e.g. "/tmp/upload_123report.pdf" into the vector metadata. The
            # object key is the stable identifier for the same file and does not
            # leak the server's temp directory. Deliberate divergence --
            # recorded in the findings document.
            raw_text=raw_text,
            doc_id=doc_id,
            owner_user_id=owner_id,
            source=file_url,
            title=title,
            file_type=file_type,
        )

        config = get_config()
        embedder = DashScopeEmbedder(
            api_key=config.dashscope_api_key or "",
            base_url=config.dashscope_base_url,
            model=config.embedding_model,
        )
        vectors = _run_async(embedder.embed([payload.text for payload in payloads]))

        writer = ChromaWriter(config)
        writer.add(payloads, vectors)
    except (VectorStoreUnavailable, UnsupportedFormat):
        logger.exception("[ETL] vector stage failed: docId=%s", doc_id)
        _mark(doc_id, STATUS_FAILED)
        return
    except Exception:  # noqa: BLE001 - the catch-all that keeps status honest
        logger.exception("[ETL] document processing failed: docId=%s", doc_id)
        _mark(doc_id, STATUS_FAILED)
        return

    _mark(doc_id, STATUS_COMPLETED, chunk_count=len(payloads))


def _run_async(coroutine):
    """Drive a coroutine from sync code.

    ``process_document`` has to be a plain function because FastAPI background
    tasks run it after the request's session is gone, and it opens its own.
    Every awaitable it touches is created here, so there is never a loop to
    re-enter -- a fresh one per call is correct and cheap.
    """
    import asyncio

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        # No loop in this thread (the common case: a Starlette worker thread).
        return asyncio.run(coroutine)
    # Already inside a loop -- run on a private one so we never nest.
    return asyncio.new_event_loop().run_until_complete(coroutine)


def _mark(doc_id: int, status: int, chunk_count: int | None = None) -> None:
    """``updateStatus`` -- writes ``status``, and ``chunkCount`` when known.

    Mirrors Java exactly: a failed ETL leaves ``chunkCount`` alone (``null``),
    which is what ``deleteDocument`` checks before trying to remove vectors.
    """
    session = db_session()
    try:
        document = session.get(KnowledgeDocument, doc_id)
        if document is None:
            return
        document.status = status
        if chunk_count is not None:
            document.chunk_count = chunk_count
        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("[ETL] status update failed: docId=%s", doc_id)
    finally:
        session.close()


# ---------------------------------------------------------------------------
# POST /knowledge/list/page
# ---------------------------------------------------------------------------
@router.post("/list/page", summary="分页查询我的知识库文档")
def list_documents(
    body: KnowledgePageQuery,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(require_user),
):
    """``listPage``.

    Newest first, scoped to the caller. Returns the raw entity -- there is no
    VO in Java, so ``contentHash``, ``fileUrl`` and ``isDelete`` are all on the
    wire. Reproduced rather than desensitized: the frontend's generated client
    declares those fields.
    """
    total = db.execute(
        select(func.count())
        .select_from(KnowledgeDocument)
        .where(KnowledgeDocument.user_id == int(user.id))
        .where(KnowledgeDocument.is_delete == 0)
    ).scalar_one()
    rows = db.execute(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.user_id == int(user.id))
        .where(KnowledgeDocument.is_delete == 0)
        .order_by(KnowledgeDocument.create_time.desc())
        .limit(body.pageSize)
        .offset((body.current - 1) * body.pageSize)
    ).scalars().all()
    return BaseResponse.success(
        PageResult.of([KnowledgeDocumentVO.model_validate(row, from_attributes=True) for row in rows],
                      total, body.pageSize, body.current)
    )


# ---------------------------------------------------------------------------
# DELETE /knowledge/delete
# ---------------------------------------------------------------------------
@router.delete("/delete", summary="删除知识库文档")
def delete_document(
    body: DeleteRequest,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(require_user),
):
    """``deleteDocument``.

    **DELETE with a request body.** ``@DeleteMapping`` + ``@RequestBody
    DeleteRequest`` -- unusual, and some proxies drop bodies on DELETE. Nginx is
    configured to pass them through (Phase 3); if that fails, the query-parameter
    fallback would need a matching frontend change (finding R5).

    Cleanup order is vectors -> COS -> row, and each step catches its own
    failure so a Chroma outage still removes the database row. The consequence
    is real and reproduced: orphaned vectors stay in the collection, invisible
    and unreachable, since they can only be deleted by id and no id survives the
    row.

    Always returns ``true``. The failures are logged, never surfaced.
    """
    document_id = int(body.id) if body.id is not None else None
    if document_id is None:
        raise BizError(ErrorCode.PARAMS_ERROR)

    document = db.get(KnowledgeDocument, document_id)
    # Order matters: Java checks isDelete before ownership, so a soft-deleted
    # document reports "not found" rather than "not yours" even to a stranger.
    if document is None:
        raise BizError(ErrorCode.NOT_FOUND_ERROR)
    if document.is_delete == 1:
        raise BizError(ErrorCode.NOT_FOUND_ERROR, ALREADY_DELETED)
    if document.user_id != int(user.id):
        raise BizError(ErrorCode.NO_AUTH_ERROR)

    if document.chunk_count:
        _delete_vectors(document_id, document.chunk_count)

    try:
        _delete_object(document.file_url)
    except Exception:  # noqa: BLE001
        logger.warning("COS delete failed, will retry via compensation: docId=%s", document_id)

    # Logical delete -- @TableLogic turns deleteById into `SET isDelete=1`.
    document.is_delete = 1
    db.flush()
    return BaseResponse.success(True)


def _delete_vectors(doc_id: int, chunk_count: int) -> None:
    """``vectorStore.delete(buildChunkIds(...))``, failures swallowed.

    A failure here leaves vectors that nothing can ever delete again -- the row
    is about to be gone and the ids are derived from ``chunkCount``. That is
    Java's behaviour; the compensation path it alludes to does not exist in this
    repository.
    """
    from web.vectorstore import ChromaWriter

    try:
        writer = ChromaWriter(get_config())
        writer.delete(chunk_ids(doc_id, chunk_count))
    except Exception:  # noqa: BLE001 - including VectorStoreUnavailable
        logger.warning("vector delete failed, continuing: docId=%s", doc_id, exc_info=True)


def _delete_object(key: str) -> None:
    config = get_config()
    import qcloud_cos

    client = qcloud_cos.CosConfig(
        Region=config.cos_region, SecretId=config.cos_secret_id, SecretKey=config.cos_secret_key
    )
    qcloud_cos.COSClient(client).delete_object(Bucket=config.cos_bucket, Key=key)

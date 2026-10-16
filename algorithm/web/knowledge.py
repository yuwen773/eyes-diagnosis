"""Knowledge ETL -- the Chroma **write** side of the RAG pipeline.

This is a port of three Java classes that move to Python in Phase 2.4:

* ``agent/rag/DocumentParser.java``       -- text extraction + paragraph split
* ``agent/rag/TextChunkerService.java``   -- character-window chunking
* ``service/impl/DocumentProcessingService.java`` -- the extract/transform/load flow

The **read** side (``agent/tools/DocumentSearchTool.java``) stays on Java, so
everything in this module is a cross-language contract. A mismatch anywhere in
the list below makes Java's retrieval return *empty with no error*:

===========================  ===========================================
Chroma collection            ``diagnosis-knowledge`` (not the Java
                             ``@Value`` default -- see ruling 1)
tenant / database            ``default_tenant`` / ``default_database``
embedding model              DashScope ``text-embedding-v3``, default
                             dimension; a different dimension makes the
                             collection reject the write outright
metadata ``ownerUserId``     **an integer**. Java filters with
                             ``ownerUserId == <currentUserId>`` against a
                             ``Long`` -- a string value silently matches
                             nothing, which is the multi-tenant isolation
                             guarantee
metadata ``docId``           a **string**; ``documentId`` is the integer
chunk ids                    ``doc_{docId}_chunk_{i}``, 0-based
===========================  ===========================================

Deliberately reproduced defects
------------------------------
**The chunker duplicates the segment that triggers a rollover.**
``TextChunkerService.java:41-48`` appends ``trimmed`` inside the overflow
branch, then falls through to append it *again* at :55-57. Every segment that
starts a new chunk therefore appears twice in that chunk. Reproduced, because
the chunk count and therefore the ``chunk_{i}`` id sequence -- which
``deleteDocument`` builds from -- depend on it. Fixing it here would orphan
vectors written by Java before the cutover.

**``source`` metadata is an absolute temp path.** ``processDocument:69`` passes
``file.getAbsolutePath()``, i.e. something like ``/tmp/upload_12345report.pdf``,
into the vector metadata. That leaks the server's filesystem layout into a
store the Agent can quote back. Reproduced; logged in the findings document.

Import safety
-------------
Nothing heavy is imported at module scope: ``chromadb``, ``pypdf`` and
``python-docx`` are all absent from the default interpreter, which is what the
``python-web`` CI job installs.
"""

import base64
import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

#: ``KnowledgeBaseServiceImpl.ALLOWED_TYPES`` -- note ``doc`` is the legacy
#: binary Word format, handled by the pinned non-JVM local converter.
ALLOWED_TYPES = frozenset({"pdf", "doc", "docx", "txt", "md", "markdown"})

#: ``eye-diagnosis.rag.chunk-size`` / ``chunk-overlap`` (``TextChunkerService``).
#: **Characters, not words.** The class docstring in the migration plan called
#: this a "512-word sliding window"; the code is character-based and the log
#: message at :85 says so. Chars it is.
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100

#: Blank-line paragraph separator, verbatim from both Java classes:
#: ``split("\\n\\s*\\n")``.
_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")

#: ``String.trim()`` removes code points <= U+0020 and nothing else. Python's
#: ``str.strip()`` also eats U+3000 (ideographic space) and other Unicode
#: whitespace, which Chinese documents contain. Using ``strip()`` would silently
#: alter paragraph text and change chunk boundaries.
_JAVA_TRIM = re.compile(r"^[\x00-\x20]+|[\x00-\x20]+$")

#: ``DocumentParser.parse:41`` -- paragraphs shorter than this are dropped.
MIN_PARAGRAPH_LENGTH = 20


def java_trim(text: str) -> str:
    """``String.trim()`` -- whitespace up to U+0020 only, unlike ``str.strip()``."""
    return _JAVA_TRIM.sub("", text)


def has_text(text: str | None) -> bool:
    """``StringUtils.hasText`` -- non-null, non-empty, contains non-whitespace."""
    return text is not None and bool(text.strip())


# ---------------------------------------------------------------------------
# File type -- KnowledgeBaseServiceImpl:203-211
# ---------------------------------------------------------------------------
def resolve_file_type(filename: str | None) -> str:
    """Port of ``getFileType``.

    Error messages are reproduced because they are concatenated into the
    per-file failure report that ``uploadDocument`` returns
    (``"名字（消息）"``), which the client shows verbatim.

    ``lastIndexOf('.') <= 0`` rejects both a missing dot and a dotfile like
    ``.md`` -- the leading-dot name has no stem, so the extension Java would
    compute is the whole name, which is not in the allow-list anyway.
    """
    if filename is None:
        raise ValueError("文件名不能为空")
    last_dot = filename.rfind(".")
    if last_dot <= 0:
        raise ValueError("无法识别文件类型")
    file_type = filename[last_dot + 1 :].lower()
    if file_type not in ALLOWED_TYPES:
        # Java prints the Set's toString, whose iteration order is unspecified.
        # Reproduced as sorted so the message is stable and testable; the
        # content is the same set.
        raise ValueError(
            f"不支持的文件类型: {file_type}，支持: [{', '.join(sorted(ALLOWED_TYPES))}]"
        )
    return file_type


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------
def file_content_hash(data: bytes) -> str:
    """``DocumentProcessingService.computeContentHash(File)`` -- hex SHA-256.

    This is the **dedup** hash stored in ``t_knowledge_document.contentHash``.
    Not to be confused with :func:`content_hash`, which is a different function
    that happens to share the name in Java.
    """
    return hashlib.sha256(data).hexdigest()


def content_hash(text: str) -> str:
    """``DocumentParser.computeContentHash(String)`` -- Base64 SHA-256, 16 chars.

    Used only for the ``contentHash`` *metadata* field. Java falls back to a
    random UUID prefix if SHA-256 is unavailable, which cannot happen on any
    supported platform, so that branch is not ported.
    """
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")[:16]


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
class UnsupportedFormat(ValueError):
    """Raised for a file type without an extractor, distinct from corrupt input."""


class DocumentParseError(ValueError):
    """Unreadable input, distinct from a valid document with no text."""


def _extract(data: bytes, file_type: str) -> str:
    """Text from raw bytes.

    Java delegates the whole matrix to Apache Tika, which sniffs content and
    pulls in POI/pdfbox. Python uses a narrow reader per type, with the pinned
    local non-JVM converter for binary Word.

    Every backend is imported inside the branch: none of them may appear at
    module scope.
    """
    if file_type == "pdf":
        from web.extract import extract_pdf

        return extract_pdf(data)
    if file_type == "docx":
        from web.extract import extract_docx

        return extract_docx(data)
    if file_type in ("txt", "md", "markdown"):
        # Java goes through Tika even for plain text; Tika honours the charset
        # from the bytes (or falls back to ISO-8859-1). UTF-8 with replacement
        # is the pragmatic match and is what every real document here uses.
        return data.decode("utf-8", errors="replace")
    if file_type == "doc":
        from web.doc_parser import extract_doc

        return extract_doc(data)
    raise UnsupportedFormat(f"未实现的文件类型: {file_type}")


def parse(data: bytes, file_type: str) -> list[str]:
    """``DocumentParser.parse`` -- split into paragraphs.

    Issue 07 separates parse errors from valid empty text. The upload route
    catches errors per file, so an unreadable file does not abort the batch.
    Word retains short blocks so cells and headers cannot be filtered out.

    The fallback matters: when no paragraph is longer than
    :data:`MIN_PARAGRAPH_LENGTH`, Java returns the **whole** content as a
    single paragraph rather than nothing. This legacy rule remains for the
    other formats; the character-window chunker is unchanged for all formats.
    """
    try:
        content = _extract(data, file_type)
    except UnsupportedFormat:
        raise
    except Exception as exc:  # noqa: BLE001 - report parse errors per uploaded file
        logger.exception("document extraction failed")
        raise DocumentParseError(f"文档解析失败：{exc}") from exc

    if not has_text(content):
        return []

    # Word's short cells and headers are meaningful content. Keep every nonblank
    # Word block; the legacy plain-text/PDF filter and chunker remain unchanged.
    if file_type in {"doc", "docx"}:
        return [java_trim(para) for para in _PARAGRAPH_SPLIT.split(content) if has_text(para)]

    paragraphs = [
        trimmed
        for trimmed in (java_trim(para) for para in _PARAGRAPH_SPLIT.split(content))
        if len(trimmed) > MIN_PARAGRAPH_LENGTH
    ]
    return [content] if not paragraphs else paragraphs


def merge_paragraphs(paragraphs: list[str]) -> str:
    """``processDocument:75`` -- join with a blank line and trim.

    ``reduce("", (a, b) -> a + "\\n\\n" + b)`` puts the separator **before**
    every element including the first, so the result starts with ``"\\n\\n"``
    and is then trimmed. Equivalent to ``"\\n\\n".join(paragraphs)``.
    """
    return java_trim("\n\n".join(paragraphs))


# ---------------------------------------------------------------------------
# Chunking -- TextChunkerService.java:27-64
# ---------------------------------------------------------------------------
def chunk(text: str | None, chunk_size: int = CHUNK_SIZE,
          overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Character-window chunking, reproduced **including the duplicate append**.

    See the module docstring. The shape of the bug, for anyone auditing this:

    * the overflow branch appends ``trimmed`` once (:48)
    * control then falls through to the unconditional append at :55-57, which
      appends ``trimmed`` **again**

    so the first segment of every chunk after the first appears twice. The
    ``chunk_{i}`` id sequence depends on the resulting count, so this cannot be
    "tidied" without orphaning vectors written by Java.
    """
    if not text:
        return []

    chunks: list[str] = []
    current = ""

    for segment in _PARAGRAPH_SPLIT.split(text):
        trimmed = java_trim(segment)
        if not trimmed:
            continue

        if current and len(current) + len(trimmed) + 2 > chunk_size:
            chunks.append(java_trim(current))
            overlap_text = (
                current[len(current) - overlap:] if len(current) > overlap else current
            )
            current = (overlap_text + "\n\n") if overlap_text else ""
            current += trimmed  # first append -- the bug lives here

        if current:
            current += "\n\n"
        current += trimmed  # second append

    remaining = java_trim(current)
    if remaining:
        chunks.append(remaining)
    return chunks


def chunk_ids(doc_id: int, count: int) -> list[str]:
    """``doc_{docId}_chunk_{i}``, 0-based.

    Built twice in Java -- once in ``processDocument`` and once in
    ``KnowledgeBaseServiceImpl.buildChunkIds`` (:207-212) -- from the same
    format. ``deleteDocument`` uses it to remove vectors, so it must stay
    identical or deletion silently leaves orphans behind.
    """
    return [f"doc_{doc_id}_chunk_{i}" for i in range(count)]


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ChunkPayload:
    """One chunk ready for Chroma."""

    id: str
    text: str
    #: JSON-serialisable. Types matter: ``ownerUserId`` and ``documentId`` are
    #: **integers** because Java's filter expression compares them numerically.
    metadata: dict[str, Any]


def build_metadata(
    *,
    raw_text: str,
    source: str,
    title: str | None,
    file_type: str | None,
    doc_id: int,
    owner_user_id: int,
    timestamp: datetime | None = None,
) -> dict[str, Any]:
    """``DocumentParser.buildMetadata`` + the three keys ``processDocument:79-81``
    adds on top.

    Key types are the whole point of this function:

    =================  =========  ==========================================
    key                type       why
    =================  =========  ==========================================
    ``ownerUserId``    int        Java filters ``ownerUserId == <Long>``.
                               A string here matches nothing and silently
                               returns no documents.
    ``documentId``     int        same, and read by BM25 fusion.
    ``docId``          str        read back and shown to the model by
                               ``formatDocuments``. Java stores
                               ``docId.toString()``.
    =================  =========  ==========================================

    ``timestamp`` is ``Instant.now().toString()`` in Java -- UTC ISO-8601 with
    a trailing ``Z``. Matched here; the other timestamps in this project are
    naive local time.
    """
    stamp = timestamp or datetime.now(timezone.utc)
    return {
        "source": source,
        "title": title if title is not None else "",
        "fileType": file_type if file_type is not None else "",
        "timestamp": stamp.isoformat().replace("+00:00", "Z"),
        "contentHash": content_hash(raw_text),
        "docId": str(doc_id),
        "documentId": int(doc_id),
        "ownerUserId": int(owner_user_id),
    }


def build_chunks(
    *,
    raw_text: str,
    doc_id: int,
    owner_user_id: int,
    source: str,
    title: str | None,
    file_type: str | None,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[ChunkPayload]:
    """``processDocument:85-97`` -- chunk, then stamp ids and re-assert the
    owner on every chunk.

    The metadata is shared by reference in Java's ``addChunk``; the per-chunk
    copy there exists to guarantee ``ownerUserId`` survives. A fresh dict per
    chunk is cheaper than copying and equally safe.
    """
    metadata = build_metadata(
        raw_text=raw_text,
        source=source,
        title=title,
        file_type=file_type,
        doc_id=doc_id,
        owner_user_id=owner_user_id,
    )
    texts = chunk(raw_text, chunk_size, overlap)
    return [
        ChunkPayload(id=chunk_id, text=text, metadata=dict(metadata))
        for chunk_id, text in zip(chunk_ids(doc_id, len(texts)), texts)
    ]

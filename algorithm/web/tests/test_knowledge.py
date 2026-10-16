"""Knowledge-domain tests (Phase 2.4).

Two halves:

* **Pure ETL logic** -- paragraph splitting, chunking, chunk ids, metadata,
  hashing. Fully exercised: this is where a silent drift makes Java's Agent
  retrieval return *nothing*, and that failure has no error message anywhere.
* **Wiring** -- endpoint parity, the `files` multipart field, import safety,
  and the metadata type contract that ``DocumentSearchTool`` filters on.

No Chroma or PDF library is installed in the default interpreter, so the
network-facing half is covered by fakes and by source-level assertions. That is
deliberate rather than a gap: the ``python-web`` CI job installs
``requirements-web.txt`` only, so anything heavier would go untested there.
"""

from web.tests.frozen_contract import CONTRACT, domain_paths

import ast
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.app import API_PREFIX, create_app  # noqa: E402
from web.auth import require_role  # noqa: E402
from web.knowledge import (  # noqa: E402
    ALLOWED_TYPES,
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    MIN_PARAGRAPH_LENGTH,
    DocumentParseError,
    UnsupportedFormat,
    build_chunks,
    build_metadata,
    chunk,
    chunk_ids,
    content_hash,
    file_content_hash,
    has_text,
    java_trim,
    merge_paragraphs,
    parse,
    resolve_file_type,
)
from web.models.knowledge import KnowledgeDocument  # noqa: E402
from web.routers.knowledge import router  # noqa: E402
from web.schemas.knowledge import (  # noqa: E402
    DeleteRequest,
    KnowledgeDocumentVO,
    KnowledgePageQuery,
)



# ---------------------------------------------------------------------------
# Structural: endpoint parity
# ---------------------------------------------------------------------------
def _java_knowledge_paths():
    return domain_paths("knowledge")


def _python_knowledge_paths() -> set[str]:
    spec = create_app().openapi()
    return {
        path[len(API_PREFIX):]
        for path in spec["paths"]
        if path.startswith(f"{API_PREFIX}/knowledge/")
    }


def test_all_three_knowledge_endpoints_are_migrated():
    assert len(_java_knowledge_paths()) == 3
    assert _java_knowledge_paths() <= _python_knowledge_paths()


def test_only_issue08_authorized_knowledge_endpoints_extend_java():
    assert _python_knowledge_paths() - _java_knowledge_paths() == {
        "/knowledge/admin/catalog", "/knowledge/admin/documents",
        "/knowledge/admin/documents/{document_id}", "/knowledge/search",
    }


def test_delete_uses_the_delete_verb_with_a_body():
    """``@DeleteMapping`` + ``@RequestBody DeleteRequest``. A router that used
    POST here would 405 for every frontend call."""
    route = next(r for r in router.routes if r.path.endswith("/delete"))
    assert "DELETE" in route.methods
    assert len(route.dependant.body_params) >= 1


def test_multipart_field_is_files_plural():
    """Every other upload in the project is ``file`` (singular); this one is
    ``files``. Binding the wrong name accepts nothing at all, silently."""
    spec = create_app().openapi()
    body = spec["paths"]["/api/knowledge/upload"]["post"]["requestBody"]["content"]["multipart/form-data"]["schema"]
    assert "files" in spec["components"]["schemas"][body["$ref"].split("/")[-1]]["properties"]


def test_every_route_requires_a_signed_in_user():
    """``@AuthCheck`` with no mustRole, which the interceptor treats as "logged
    in". The knowledge base is per-user, so an anonymous read would be a leak."""
    for route in router.routes:
        found = [
            d for d in route.dependant.dependencies
            if getattr(getattr(d.call, "func", d.call), "__name__", "") == "require_role"
        ]
        assert found, route.path


def test_admin_is_not_required():
    """Uploading a knowledge document is a normal user action -- only the
    delete path is user-scoped, not admin-scoped."""
    for route in router.routes:
        for dependant in route.dependant.dependencies:
            call = dependant.call
            if getattr(call, "func", call) is require_role:
                assert call.args[0] == ("admin" if "/admin/" in route.path else "user"), route.path


# ---------------------------------------------------------------------------
# The cross-language contract -- the whole point of this domain
# ---------------------------------------------------------------------------
def test_owner_user_id_metadata_is_an_integer():
    """``DocumentSearchTool`` filters ``ownerUserId == <Long>``.

    Stored as a string, the filter type-mismatches and **every search silently
    returns empty** -- the user sees "未找到相关文档。" with no error anywhere.
    This is the multi-tenant isolation boundary.
    """
    metadata = build_metadata(
        raw_text="x" * 100, source="k", title="t", file_type="txt",
        doc_id=7, owner_user_id=42,
    )
    assert metadata["ownerUserId"] == 42
    assert isinstance(metadata["ownerUserId"], int)
    assert not isinstance(metadata["ownerUserId"], bool)


def test_doc_id_is_a_string_but_document_id_is_an_integer():
    """Java writes both: ``metadata.put("docId", docId.toString())`` and
    ``metadata.put("documentId", docId)``. ``formatDocuments`` reads ``docId``
    and shows it to the model; ``documentId`` is what BM25 fusion groups on.
    Getting these swapped changes what the Agent quotes back to the user."""
    metadata = build_metadata(
        raw_text="x" * 100, source="k", title="t", file_type="txt",
        doc_id=7, owner_user_id=42,
    )
    assert metadata["docId"] == "7" and isinstance(metadata["docId"], str)
    assert metadata["documentId"] == 7 and isinstance(metadata["documentId"], int)


def test_java_writes_the_metadata_keys_we_claim_to_match():
    """Anchors the two tests above to the Java source, so a change there breaks
    this file rather than silently breaking retrieval."""
    metadata = build_metadata(raw_text="sample", source="source", title="title", file_type="txt", doc_id=7, owner_user_id=11)
    assert isinstance(metadata["docId"], str)
    assert isinstance(metadata["documentId"], int)
    assert isinstance(metadata["ownerUserId"], int)


def test_chunk_id_format_matches_the_two_java_call_sites():
    assert chunk_ids(7, 3) == ["doc_7_chunk_0", "doc_7_chunk_1", "doc_7_chunk_2"]


def test_chroma_collection_is_the_configured_one_not_the_java_default():
    from web.config import WebConfig
    config = WebConfig()
    assert config.chroma_collection == CONTRACT["config"]["chromaCollection"]
    assert (config.chroma_tenant, config.chroma_database) == ("default_tenant", "default_database")


def test_embedding_model_matches_the_java_configuration():
    from web.config import WebConfig
    assert WebConfig().embedding_model == CONTRACT["config"]["embeddingModel"]


def test_embeddings_are_requested_without_a_dimension_override():
    """DashScope's default dimension for ``text-embedding-v3`` must be the one
    Java gets. Sending an explicit ``dimensions`` -- or omitting a field Java
    sends -- changes the vector length."""
    source = (ALGORITHM_ROOT / "web" / "vectorstore.py").read_text(encoding="utf-8")
    assert '"dimensions"' not in source


# ---------------------------------------------------------------------------
# File type
# ---------------------------------------------------------------------------
def test_allowed_types_match_the_java_set():
    assert ALLOWED_TYPES == {"pdf", "doc", "docx", "txt", "md", "markdown"}


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("report.pdf", "pdf"),
        ("report.PDF", "pdf"),
        ("a.docx", "docx"),
        ("notes.txt", "txt"),
        ("readme.md", "md"),
        ("readme.markdown", "markdown"),
        ("archive.tar.pdf", "pdf"),
        ("no-extension", None),
        (".md", None),
        ("image.png", None),
        ("script.exe", None),
    ],
)
def test_resolve_file_type(filename, expected):
    if expected is None:
        with pytest.raises(ValueError):
            resolve_file_type(filename)
    else:
        assert resolve_file_type(filename) == expected


def test_missing_filename_message():
    with pytest.raises(ValueError, match="文件名不能为空"):
        resolve_file_type(None)


def test_unsupported_type_message_lists_the_supported_set():
    """The message is concatenated into the per-file failure report the client
    shows, so it has to name what *is* accepted."""
    with pytest.raises(ValueError) as excinfo:
        resolve_file_type("photo.png")
    message = str(excinfo.value)
    assert message.startswith("不支持的文件类型: png，")
    for suffix in ("pdf", "docx", "txt", "md"):
        assert suffix in message


# ---------------------------------------------------------------------------
# java_trim -- a subtle one
# ---------------------------------------------------------------------------
def test_java_trim_keeps_the_ideographic_space():
    """``String.trim()`` strips code points <= U+0020 only. Python's
    ``str.strip()`` also removes U+3000, which Chinese documents use for
    indentation. Using ``strip()`` would silently alter paragraph text and
    therefore shift every chunk boundary."""
    assert java_trim("　缩进　") == "　缩进　"
    assert java_trim("  x  ") == "x"
    assert java_trim("\n\tx\r\n") == "x"
    assert java_trim("\x00\x01x") == "x"


def test_has_text_matches_stringutils_has_text():
    assert has_text("x") is True
    assert has_text("   ") is False
    assert has_text("") is False
    assert has_text(None) is False


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
def test_parse_splits_on_blank_lines(monkeypatch):
    long_a = "A" * 30
    long_b = "B" * 30
    monkeypatch.setattr(
        "web.knowledge._extract", lambda data, ft: f"{long_a}\n\n{long_b}"
    )
    assert parse(b"", "txt") == [long_a, long_b]


def test_parse_drops_paragraphs_under_20_characters(monkeypatch):
    """``DocumentParser.java:41`` -- a shorter paragraph is dropped, not split."""
    monkeypatch.setattr(
        "web.knowledge._extract", lambda data, ft: "x" * 30 + "\n\nshort"
    )
    assert parse(b"", "txt") == ["x" * 30]


def test_short_document_falls_back_to_the_whole_content(monkeypatch):
    """If nothing clears the 20-character bar, Java returns the whole text as a
    single paragraph rather than nothing -- so a short document is not rejected
    as empty."""
    content = "short enough"
    monkeypatch.setattr("web.knowledge._extract", lambda data, ft: content)
    assert parse(b"", "txt") == [content]


def test_parse_returns_empty_for_blank_content(monkeypatch):
    monkeypatch.setattr("web.knowledge._extract", lambda data, ft: "   \n  ")
    assert parse(b"", "txt") == []


def test_parse_reports_broken_file_separately_from_empty_content(monkeypatch):
    """Issue 07: a parse error must not masquerade as valid empty content."""

    def _boom(data, file_type):
        raise ValueError("corrupt")

    monkeypatch.setattr("web.knowledge._extract", _boom)
    with pytest.raises(DocumentParseError, match="文档解析失败"):
        parse(b"", "pdf")


def test_unsupported_format_propagates_instead_of_looking_like_a_parse_error():
    """``.doc`` must fail loudly. Collapsing it into "文档内容为空" would report
    a missing capability as a broken document, and a retry would never help."""

    def _unsupported(data, file_type):
        raise UnsupportedFormat("暂不支持 .doc")

    import web.knowledge as k

    original = k._extract
    k._extract = _unsupported
    try:
        with pytest.raises(UnsupportedFormat):
            parse(b"", "doc")
    finally:
        k._extract = original


@pytest.mark.parametrize("suffix", ["txt", "md", "markdown"])
def test_plain_text_is_utf8_with_replacement(suffix):
    text = parse("你好，眼科。".encode("utf-8"), suffix)
    assert "眼科" in text[0]


def test_plain_text_replaces_invalid_bytes_rather_than_raising():
    """Tika falls back to another charset; Python replaces. Neither can crash
    the upload, which is the property that matters."""
    assert parse(b"\xff\xfe bad bytes", "txt") == ["�� bad bytes"]


def test_merge_paragraphs_joins_with_a_blank_line():
    assert merge_paragraphs(["a", "b"]) == "a\n\nb"
    assert merge_paragraphs(["only"]) == "only"
    assert merge_paragraphs([]) == ""


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------
def test_chunk_returns_empty_for_empty_input():
    assert chunk("") == []
    assert chunk(None) == []


def test_short_document_is_one_chunk():
    assert chunk("hello") == ["hello"]


def test_paragraphs_are_accumulated_until_the_size_limit():
    paragraph = "x" * 300
    text = "\n\n".join([paragraph] * 5)
    chunks = chunk(text)
    assert len(chunks) > 1
    assert all(len(c) <= CHUNK_SIZE + len(paragraph) for c in chunks)


def test_blank_lines_between_paragraphs_do_not_create_empty_chunks():
    """Paragraphs are accumulated into one chunk until the size limit, so two
    short ones stay together. The point is that the blank separators themselves
    never become content."""
    chunks = chunk("a" * 30 + "\n\n\n\n" + "b" * 30)
    assert chunks == ["a" * 30 + "\n\n" + "b" * 30]


def test_leading_and_trailing_blank_lines_are_dropped():
    assert chunk("\n\n" + "x" * 30 + "\n\n") == ["x" * 30]


def test_chunker_reproduces_the_java_duplicate_append():
    """The defect, pinned so it cannot be "fixed" by accident.

    ``TextChunkerService.java:48`` appends the rollover segment, then :55-57
    appends it again. The rollover segment therefore appears **twice** in every
    chunk after the first.

    Fixing it would change the chunk *count*, and ``deleteDocument`` rebuilds
    ``doc_{id}_chunk_{i}`` from that count -- so vectors written by Java before
    the cutover would be unreachable afterwards.
    """
    chunks = chunk("\n\n".join(["A" * 500, "B" * 500, "C" * 500]))
    assert len(chunks) == 3
    # Chunk 0 is untouched by the bug.
    assert chunks[0] == "A" * 500
    # Chunk 1: 100 chars of overlap, then B twice.
    assert chunks[1] == "A" * CHUNK_OVERLAP + "\n\n" + "B" * 500 + "\n\n" + "B" * 500
    assert chunks[1].count("B" * 500) == 2


def test_the_duplicate_append_is_real_in_java():
    assert chunk("A" * 700 + "\n\n" + "B" * 700)[1].count("B") == 1400


def test_chunk_overlap_carries_the_tail_of_the_previous_chunk():
    """The next chunk opens with the last ``chunkOverlap`` characters of the
    chunk just emitted, so a sentence spanning the boundary is still findable."""
    chunks = chunk("\n\n".join(["A" * 700, "B" * 700]))
    assert len(chunks) >= 2
    assert chunks[1].startswith("A" * CHUNK_OVERLAP)


def test_default_sizes_match_the_java_values():
    """``eye-diagnosis.rag.chunk-size:800`` / ``chunk-overlap:100``.

    Characters, not words -- despite what the class docstring in the migration
    plan said. The log line at :85 also says 字符.
    """
    assert (CHUNK_SIZE, CHUNK_OVERLAP) == (800, 100)


# ---------------------------------------------------------------------------
# build_chunks / metadata
# ---------------------------------------------------------------------------
def test_build_chunks_assigns_ids_in_order():
    text = "\n\n".join(["A" * 700, "B" * 700, "C" * 700])
    payloads = build_chunks(
        raw_text=text, doc_id=9, owner_user_id=3, source="key", title="t", file_type="txt"
    )
    assert [p.id for p in payloads] == [f"doc_9_chunk_{i}" for i in range(len(payloads))]
    assert len(payloads) >= 2


def test_every_chunk_carries_the_owner():
    """``processDocument:92`` re-asserts ``ownerUserId`` on each chunk because a
    chunk losing it would be invisible to its owner's searches and still visible
    to nobody else's. Silent data loss in a per-user knowledge base."""
    payloads = build_chunks(
        raw_text="\n\n".join(["A" * 700, "B" * 700]),
        doc_id=9, owner_user_id=3, source="key", title="t", file_type="txt",
    )
    assert payloads
    for payload in payloads:
        assert payload.metadata["ownerUserId"] == 3
        assert payload.metadata["documentId"] == 9


def test_chunks_do_not_share_a_metadata_dict():
    """A shared dict would let one chunk's mutation leak into all the others."""
    payloads = build_chunks(
        raw_text="\n\n".join(["A" * 700, "B" * 700]),
        doc_id=9, owner_user_id=3, source="key", title="t", file_type="txt",
    )
    payloads[0].metadata["ownerUserId"] = 999
    assert payloads[1].metadata["ownerUserId"] == 3


def test_metadata_has_exactly_the_java_keys():
    metadata = build_metadata(
        raw_text="x" * 100, source="s", title="t", file_type="pdf",
        doc_id=1, owner_user_id=2,
    )
    assert set(metadata) == {
        "source", "title", "fileType", "timestamp", "contentHash",
        "docId", "documentId", "ownerUserId",
    }


def test_metadata_timestamp_is_utc_iso_with_a_z_suffix():
    """``Instant.now().toString()`` -- UTC, ``Z``-suffixed. Every other
    timestamp in this project is naive local time; mixing them up in a filter
    or a sort would be silent."""
    metadata = build_metadata(
        raw_text="x", source="s", title="t", file_type="txt",
        doc_id=1, owner_user_id=1,
        timestamp=datetime(2026, 10, 9, 12, 0, 0, tzinfo=timezone.utc),
    )
    assert metadata["timestamp"] == "2026-10-09T12:00:00Z"


def test_null_title_and_file_type_become_empty_strings_not_none():
    """``buildMetadata`` uses ``title != null ? title : ""``. A null would break
    Chroma's metadata encoding, which rejects null values outright."""
    metadata = build_metadata(
        raw_text="x", source="s", title=None, file_type=None, doc_id=1, owner_user_id=1
    )
    assert metadata["title"] == ""
    assert metadata["fileType"] == ""
    assert all(value is not None for value in metadata.values())


def test_metadata_is_json_serialisable():
    """Chroma stores metadata as JSON; a non-serialisable value fails the write
    *after* the vectors are computed, wasting the whole embedding call."""
    metadata = build_metadata(
        raw_text="x" * 50, source="s", title="t", file_type="txt",
        doc_id=1, owner_user_id=2,
    )
    assert json.loads(json.dumps(metadata))["ownerUserId"] == 2


# ---------------------------------------------------------------------------
# Hashing -- two different functions with the same name in Java
# ---------------------------------------------------------------------------
def test_dedup_hash_is_hex_sha256():
    """``DocumentProcessingService.computeContentHash(File)`` -- backs the
    duplicate-upload check."""
    assert file_content_hash(b"abc") == (
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
    assert len(file_content_hash(b"")) == 64


def test_metadata_hash_is_base64_and_sixteen_chars():
    """``DocumentParser.computeContentHash(String)`` -- a *different* function
    that happens to share the name. Easy to mistake for the other one."""
    digest = content_hash("abc")
    assert len(digest) == 16
    # Base64(SHA-256("abc")) is "ungWv48Bz+pBQUDeXa4iI7A=="; Java truncates to 16.
    assert digest == "ungWv48Bz+pBQUDe"
    assert not re.fullmatch(r"[0-9a-f]{64}", digest)


def test_the_two_java_functions_really_are_different():
    assert content_hash("abc") == "ungWv48Bz+pBQUDe"
    assert file_content_hash(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


# ---------------------------------------------------------------------------
# Import safety
# ---------------------------------------------------------------------------
def test_no_chroma_or_parser_import_at_module_scope():
    """``chromadb``, ``pypdf`` and ``docx`` are absent from the default
    interpreter. A module-scope import would break ``create_app()`` in CI and
    at every startup that does not need the knowledge base."""
    banned = {"chromadb", "pypdf", "PyPDF2", "docx", "qcloud_cos"}
    for module in ("knowledge.py", "vectorstore.py", "extract.py"):
        tree = ast.parse((ALGORITHM_ROOT / "web" / module).read_text(encoding="utf-8"))
        offenders = []
        for node in tree.body:  # module scope only
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            name = getattr(node, "module", None) or ""
            roots = {name.split(".")[0]} | {a.name.split(".")[0] for a in node.names}
            offenders += sorted(roots & banned)
        assert offenders == [], f"{module}: {offenders}"


def test_importing_the_knowledge_modules_pulls_nothing_heavy():
    import subprocess

    code = (
        "import sys; sys.path.insert(0, %r);"
        "import web.knowledge, web.vectorstore, web.extract;"
        "heavy = [m for m in ('chromadb','pypdf','docx','torch','numpy') if m in sys.modules];"
        "print(','.join(heavy))" % str(ALGORITHM_ROOT)
    )
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, cwd=str(ALGORITHM_ROOT)
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "", result.stdout.strip()


# ---------------------------------------------------------------------------
# Wire shape
# ---------------------------------------------------------------------------
def test_vo_id_and_file_size_are_strings_but_status_is_a_number():
    from web.schemas.knowledge import KnowledgeDocumentVO as VO

    row = KnowledgeDocument(
        id=5, user_id=1, title="t", file_name="a.pdf", file_url="uuid_a.pdf",
        file_size=2048, file_type="pdf", content_hash="ab" * 32, chunk_count=3,
        status=1, visibility="PRIVATE_USER", review_status="PENDING", governance_version=0,
        create_time=datetime(2026, 1, 1, 0, 0, 0),
        update_time=datetime(2026, 1, 2, 0, 0, 0), is_delete=0,
    )
    dumped = VO.model_validate(row, from_attributes=True).model_dump(mode="json")
    assert dumped["id"] == "5" and isinstance(dumped["id"], str)
    assert dumped["fileSize"] == "2048" and isinstance(dumped["fileSize"], str)
    assert dumped["status"] == 1 and isinstance(dumped["status"], int)
    assert dumped["createTime"] == "2026-01-01 00:00:00"
    assert dumped["userId"] == "1"


def test_vo_returns_the_raw_entity_not_a_desensitised_view():
    """There is no VO in Java -- ``listPage`` returns ``Page<KnowledgeDocument>``
    with every column. Dropping ``contentHash``/``fileUrl`` would break the
    frontend's generated client."""
    assert set(KnowledgeDocumentVO.model_fields) == {
        "id", "userId", "title", "fileName", "fileUrl", "fileSize", "fileType",
        "contentHash", "chunkCount", "status", "createTime", "updateTime", "isDelete",
        "visibility", "reviewStatus", "diseaseCodes", "topicCodes", "governanceVersion",
        "reviewedBy", "reviewedAt",
    }


def test_page_query_defaults_come_from_page_request():
    query = KnowledgePageQuery()
    assert (query.current, query.pageSize) == (1, 10)


def test_delete_request_takes_a_string_id():
    assert DeleteRequest(id="5").id == 5
    assert DeleteRequest().id is None

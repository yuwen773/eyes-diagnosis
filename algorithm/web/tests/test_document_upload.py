"""Upload-to-retrieval contracts with real files and controlled service boundaries."""

import io
import sys
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Integer, MetaData, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.app import create_app
from web.auth import LoginUser
from web.config import WebConfig
from web.deps import get_db
from web.models.knowledge import KnowledgeDocument
from web.routers import knowledge

FIXTURES = Path(__file__).parent / "fixtures" / "documents"


def table_document():
    from docx import Document

    document = Document()
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "眼底随访"
    table.cell(0, 1).text = "每年复查"
    table.cell(1, 0).text = "Ophthalmic table evidence: schedule a retinal follow-up examination."
    table.cell(1, 1).text = "定期检查"
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


@contextmanager
def controlled_pipeline(monkeypatch):
    # MySQL/COS/embedding/Chroma doubles; parsing, ETL, writer and HTTP stay real.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    table = KnowledgeDocument.__table__.to_metadata(MetaData())
    table.c.id.type = Integer()
    table.create(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    app = create_app(WebConfig(dashscope_api_key="controlled-test-key",
                               cors_allowed_origins=["http://127.0.0.1:15181"]))
    identity = [7]
    app.dependency_overrides[knowledge.require_user] = lambda: LoginUser(
        id=identity[0], userAccount="fixture", userRole="user")

    def database():
        with sessions() as session:
            yield session
            session.commit()

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(knowledge, "db_session", sessions)
    objects = {}
    monkeypatch.setattr(knowledge, "_put_object", lambda key, data: objects.update({key: data}))
    chunks = {}
    embedding_requests = []

    def embedding(request):
        import json
        payload = json.loads(request.content)
        embedding_requests.append(payload)
        return httpx.Response(200, json={"data": [
            {"index": i, "embedding": [1.0, 0.0, 0.0]} for i, _ in enumerate(payload["input"])
        ]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real_client(
        transport=httpx.MockTransport(embedding), **kw))

    class Collection:
        def upsert(self, ids, documents, embeddings, metadatas):
            for key, text, vector, metadata in zip(ids, documents, embeddings, metadatas):
                chunks[key] = {"text": text, "vector": vector, "metadata": metadata}

        def query(self, *, query_embeddings, where, n_results):
            matches = [item for item in chunks.values()
                       if item["metadata"]["ownerUserId"] == where["ownerUserId"]]
            return {"documents": [[item["text"] for item in matches[:n_results]]],
                    "metadatas": [[item["metadata"] for item in matches[:n_results]]]}

    class Chroma:
        def get_or_create_collection(self, name):
            assert name == "diagnosis-knowledge"
            return Collection()

    import chromadb
    monkeypatch.setattr(chromadb, "HttpClient", lambda **kw: Chroma())
    with TestClient(app) as client:
        yield client, objects, chunks, embedding_requests, identity, Collection()
    engine.dispose()


@pytest.fixture
def pipeline(monkeypatch):
    with controlled_pipeline(monkeypatch) as state:
        yield state


def test_table_word_upload_is_completed_and_retrievable(pipeline):
    client, objects, chunks, requests, identity, collection = pipeline
    data = table_document()
    response = client.post("/api/knowledge/upload", files={"files": (
        "retinal-table.docx", data,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}).json()
    assert response["code"] == 0, response
    doc_id = response["data"][0]
    rows = client.post("/api/knowledge/list/page", json={}).json()["data"]["records"]
    assert rows[0]["status"] == 1
    assert rows[0]["chunkCount"] > 0
    assert objects[rows[0]["fileUrl"]] == data
    result = collection.query(query_embeddings=[[1.0, 0.0, 0.0]],
                              where={"ownerUserId": 7}, n_results=20)
    text = "\n".join(result["documents"][0])
    assert "眼底随访" in text and "每年复查" in text
    assert "Ophthalmic table evidence" in text
    assert requests[0]["model"] == "text-embedding-v3"
    assert list(chunks)[0] == f"doc_{doc_id}_chunk_0"
    assert result["metadatas"][0][0]["docId"] == doc_id
    assert result["metadatas"][0][0]["documentId"] == int(doc_id)
    identity[0] = 8
    assert client.post("/api/knowledge/list/page", json={}).json()["data"]["records"] == []
    assert collection.query(query_embeddings=[[1.0, 0.0, 0.0]],
                            where={"ownerUserId": 8}, n_results=20)["documents"] == [[]]


def test_binary_word_upload_is_retrievable(pipeline):
    client, objects, chunks, requests, identity, collection = pipeline
    data = (FIXTURES / "simple.doc").read_bytes()
    assert data[:8] == bytes.fromhex("d0cf11e0a1b11ae1")
    response = client.post("/api/knowledge/upload", files={"files": (
        "word97.doc", data, "application/msword")}).json()
    assert response["code"] == 0, response
    row = client.post("/api/knowledge/list/page", json={}).json()["data"]["records"][0]
    assert row["status"] == 1
    assert objects[row["fileUrl"]] == data
    result = collection.query(query_embeddings=[[1.0, 0.0, 0.0]],
                              where={"ownerUserId": 7}, n_results=20)
    assert "This is a simple file created with Word 97-SR2." in result["documents"][0][0]


@pytest.mark.parametrize("name,data,reason", [
    ("broken.docx", b"broken ZIP", "文档解析失败"),
    ("broken.doc", bytes.fromhex("d0cf11e0a1b11ae1") + b"broken OLE", "文档解析失败"),
    ("broken.pdf", b"%PDF-1.7 broken", "文档解析失败"),
    ("wrong.exe", b"text", "不支持的文件类型"),
    ("blank.txt", b" \n\t ", "文档内容为空"),
])
def test_invalid_uploads_report_distinct_reasons_without_storing_or_embedding(pipeline, name, data, reason):
    client, objects, chunks, requests, identity, collection = pipeline
    response = client.post("/api/knowledge/upload", files={"files": (name, data)}).json()
    assert response["code"] != 0
    assert reason in response["msg"]
    assert client.post("/api/knowledge/list/page", json={}).json()["data"]["records"] == []
    assert not objects and not chunks and not requests


def test_renamed_docx_is_not_accepted_as_binary_word(pipeline):
    client = pipeline[0]
    response = client.post("/api/knowledge/upload", files={"files": (
        "renamed.doc", table_document())}).json()
    assert response["code"] != 0
    assert "文档解析失败" in response["msg"]


def test_short_cells_nested_and_merged_tables_and_active_stories_are_retrievable(pipeline):
    from docx import Document

    document = Document()
    document.add_paragraph("Body paragraph with enough text to exercise the legacy paragraph filter.")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).merge(table.cell(0, 1)).text = "合并单元格"
    table.cell(1, 0).text = "眼底"
    table.cell(1, 1).add_table(rows=1, cols=1).cell(0, 0).text = "嵌套随访"
    section = document.sections[0]
    section.header.paragraphs[0].text = "文档页眉"
    section.footer.add_table(rows=1, cols=1, width=1000000).cell(0, 0).text = "表格页脚"
    section.different_first_page_header_footer = True
    section.first_page_header.paragraphs[0].text = "首页页眉"
    document.settings.odd_and_even_pages_header_footer = True
    section.even_page_footer.paragraphs[0].text = "偶数页脚"
    document.add_section()  # Linked to the previous section, not emitted twice.
    buffer = io.BytesIO()
    document.save(buffer)
    client, _, _, _, _, collection = pipeline
    response = client.post("/api/knowledge/upload", files={"files": (
        "nested.docx", buffer.getvalue())}).json()
    assert response["code"] == 0
    text = "\n".join(collection.query(query_embeddings=[[1.0, 0.0, 0.0]],
                                    where={"ownerUserId": 7}, n_results=20)["documents"][0])
    for token in ("合并单元格", "眼底", "嵌套随访", "文档页眉", "表格页脚", "首页页眉", "偶数页脚"):
        assert text.count(token) == 1, text


def test_mixed_upload_keeps_valid_file_and_reports_rejected_file(pipeline):
    client = pipeline[0]
    response = client.post("/api/knowledge/upload", files=[
        ("files", ("good.docx", table_document())),
        ("files", ("broken.docx", b"broken ZIP")),
    ]).json()
    assert response["code"] == 0 and len(response["data"]) == 1
    assert "broken.docx" in response["msg"] and "文档解析失败" in response["msg"]
    rows = client.post("/api/knowledge/list/page", json={}).json()["data"]["records"]
    assert len(rows) == 1 and rows[0]["status"] == 1


@pytest.mark.parametrize("name", ["blank.docx", "empty.doc"])
def test_valid_empty_word_is_distinct_from_parse_failure(pipeline, name):
    from docx import Document

    if name.endswith("docx"):
        buffer = io.BytesIO()
        Document().save(buffer)
        data = buffer.getvalue()
    else:
        data = (FIXTURES / name).read_bytes()
    response = pipeline[0].post("/api/knowledge/upload", files={"files": (name, data)}).json()
    assert response["code"] != 0
    assert "文档内容为空" in response["msg"] and "解析失败" not in response["msg"]


def test_binary_word_with_corrupt_word_stream_is_rejected(pipeline, tmp_path):
    import olefile

    path = tmp_path / "corrupt.doc"
    path.write_bytes((FIXTURES / "simple.doc").read_bytes())
    with olefile.OleFileIO(path, write_mode=True) as document:
        word = document.openstream("WordDocument").read()
        document.write_stream("WordDocument", b"\x00" * len(word))
    response = pipeline[0].post("/api/knowledge/upload", files={"files": (
        "corrupt.doc", path.read_bytes())}).json()
    assert response["code"] != 0 and "文档解析失败" in response["msg"]
    assert not pipeline[2] and not pipeline[3]

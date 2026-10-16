"""Ticket 03 isolated TCP upload/search with real MySQL, Redis and Chroma.

Only creates eye_doc_issue03_* schemas and private child processes. COS and
embedding are controlled. Never connects to an existing Chroma directory.
"""

import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import traceback
from uuid import uuid4

import chromadb
import httpx
from redis import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from web.models.knowledge import KnowledgeDocument
from web.models.user import User
from web.security import encode
from web.verify_real_services import envelope, free_port, stop_child, wait_http

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "algorithm/web/tests/fixtures/documents"
ALICE, BOB, OLD_ID = 9007199254740993, 9007199254740994, 9007199254741001


def execute(args, report):
    target = make_url(os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"])
    if target.drivername != "mysql+pymysql" or target.database or target.host not in {"localhost", "127.0.0.1"}:
        raise ValueError("A local MySQL admin URL without a database is required")
    redis_binary = args.redis_server or shutil.which("redis-server")
    if not redis_binary or not Path(redis_binary).is_file():
        raise ValueError("An existing redis-server executable is required")
    schema = "eye_doc_issue03_" + uuid4().hex
    runtime = ROOT / ".scratch/baseline-runtime" / schema
    runtime.mkdir(parents=True)
    report.update(schema=schema, runtime=str(runtime))
    admin = create_engine(target)
    with admin.begin() as db:
        report["mysqlVersion"] = db.exec_driver_sql("SELECT VERSION()").scalar_one()
        db.exec_driver_sql(f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    admin.dispose()
    env = os.environ.copy()
    env.pop("JAVA_HOME", None)
    # Windows native tools remain available; no Java executable is on child PATH.
    if os.name == "nt":
        env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + str(Path(os.environ["SystemRoot"]) / "System32")
    env["MIGRATION_MYSQL_URL"] = target.set(database=schema).render_as_string(hide_password=False)
    migration = subprocess.run([sys.executable, "-m", "web.migrations", "upgrade"],
        cwd=ROOT / "algorithm", env=env, capture_output=True, timeout=180)
    assert migration.returncode == 0, "Isolated migration failed"
    engine = create_engine(target.set(database=schema))
    password, now = secrets.token_urlsafe(24), datetime(2026, 1, 1, 12)
    with Session(engine) as db:
        for user_id, account in ((ALICE, "doc_alice"), (BOB, "doc_bob")):
            db.add(User(id=user_id, user_account=account, user_password=encode(password),
                user_name=account, user_role="user", edit_time=now, create_time=now, update_time=now))
        db.add(KnowledgeDocument(id=OLD_ID, user_id=ALICE, title="Preserved original", file_name="old.txt",
            file_url="old-source", file_type="txt", file_size=64, content_hash="old-hash", status=1,
            chunk_count=1, create_time=now, update_time=now, is_delete=0))
        db.commit()
    redis_port, chroma_port, provider_port, api_port = (free_port() for _ in range(4))
    api = f"http://127.0.0.1:{api_port}"
    env.update(MYSQL_HOST=target.host, MYSQL_PORT=str(target.port or 3306), MYSQL_DATABASE=schema,
        MYSQL_USER=target.username or "", MYSQL_PASSWORD=target.password or "",
        REDIS_HOST="127.0.0.1", REDIS_PORT=str(redis_port), REDIS_DB="0", REDIS_PASSWORD="",
        CHROMA_HOST="127.0.0.1", CHROMA_PORT=str(chroma_port), CHROMA_COLLECTION="diagnosis-knowledge",
        DASHSCOPE_API_KEY="controlled-doc-key", DASHSCOPE_BASE_URL=f"http://127.0.0.1:{provider_port}/v1",
        DOC_VERIFY_OBJECTS=str(runtime / "objects"), COS_SECRET_ID="", COS_SECRET_KEY="",
        SESSION_COOKIE_SECURE="false", CORS_ALLOWED_ORIGINS="")
    with ExitStack() as stack:
        stack.callback(engine.dispose)

        def start(name, command, url=None):
            log = stack.enter_context((runtime / (name + ".log")).open("wb"))
            child = subprocess.Popen(command, cwd=ROOT / "algorithm", env=env, stdout=log, stderr=log,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            stack.callback(stop_child, child)
            if url:
                wait_http(child, url)
            return child

        start("redis", [str(redis_binary), "--bind", "127.0.0.1", "--port", str(redis_port),
            "--save", "", "--appendonly", "no", "--dir", str(runtime)])
        redis = Redis(host="127.0.0.1", port=redis_port, protocol=2)
        stack.callback(redis.close)
        deadline = time.monotonic() + 15
        while True:
            try:
                assert redis.ping()
                break
            except RedisConnectionError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.1)
        report["redisVersion"] = redis.info("server")["redis_version"]
        start("chroma", [sys.executable, "-c", "from chromadb.cli.cli import app; app()", "run",
            "--host", "127.0.0.1", "--port", str(chroma_port), "--path", str(runtime / "chroma")],
            f"http://127.0.0.1:{chroma_port}/api/v2/heartbeat")
        client = chromadb.HttpClient(host="127.0.0.1", port=chroma_port)
        collection = client.get_or_create_collection("diagnosis-knowledge")
        old = {"ids": [f"doc_{OLD_ID}_chunk_0"], "documents": ["Original retained knowledge excerpt"],
            "embeddings": [[1.0] + [0.0] * 1023], "metadatas": [{"docId": str(OLD_ID),
                "documentId": OLD_ID, "ownerUserId": ALICE, "source": "old-source"}]}
        collection.upsert(**old)
        before = collection.get(ids=old["ids"], include=["documents", "metadatas", "embeddings"])
        start("provider", [sys.executable, "-m", "web.tests.document_knowledge_process", "provider",
            "--port", str(provider_port)], f"http://127.0.0.1:{provider_port}/health")
        start("api", [sys.executable, "-m", "web.tests.document_knowledge_process", "api",
            "--port", str(api_port)], api + "/health")
        alice, bob, anonymous = [stack.enter_context(httpx.Client(base_url=api, timeout=150, trust_env=False)) for _ in range(3)]
        assert anonymous.post("/api/knowledge/upload", files={"files": ("a.doc", b"bad")}).json()["code"] == 40100
        for client, account in ((alice, "doc_alice"), (bob, "doc_bob")):
            envelope(client.post("/api/user/login", json={"userAccount": account, "userPassword": password}))
        data = (FIXTURES / "chinese-stories.doc").read_bytes()
        doc_id = envelope(alice.post("/api/knowledge/upload", files={"files": ("chinese-stories.doc", data)}))[0]
        deadline = time.monotonic() + 30
        while True:
            rows = envelope(alice.post("/api/knowledge/list/page", json={})) ["records"]
            row = next(row for row in rows if row["id"] == doc_id)
            if row["status"] != 0:
                assert row["status"] == 1, row
                break
            assert time.monotonic() < deadline
            time.sleep(.1)
        citations = envelope(alice.post("/api/knowledge/search", json={"query": "眼底随访"}))
        text = "\n".join(item["quotedText"] for item in citations if item["documentId"] == doc_id)
        for marker in ("中文眼底检查正文", "合并单元格", "眼底随访", "嵌套复查", "文档页眉", "文档页脚"):
            assert marker in text, marker
        assert row["chunkCount"] >= 2
        vectors = collection.get(where={"documentId": int(doc_id)}, include=["metadatas", "embeddings"])
        assert set(vectors["ids"]) == {f"doc_{doc_id}_chunk_{i}" for i in range(row["chunkCount"])}
        assert all(type(meta["ownerUserId"]) is int and meta["ownerUserId"] == ALICE and
            type(meta["documentId"]) is int and meta["docId"] == doc_id for meta in vectors["metadatas"])
        assert all(len(vector) == 1024 for vector in vectors["embeddings"])
        for citation in citations:
            assert citation["quotedTextDigest"] == hashlib.sha256(citation["quotedText"].encode()).hexdigest()
        assert envelope(bob.post("/api/knowledge/search", json={"query": "眼底随访"})) == []
        assert envelope(bob.post("/api/knowledge/list/page", json={"userId": str(ALICE)}))["records"] == []
        assert bob.request("DELETE", "/api/knowledge/delete", json={"id": doc_id}).json()["code"] != 0
        rejected = [("broken.doc", b"invalid", "解析失败"),
            ("empty.doc", (FIXTURES / "empty.doc").read_bytes(), "内容为空"),
            ("encrypted.doc", (FIXTURES / "PasswordProtected.doc").read_bytes(), "加密")]
        for name, content, reason in rejected:
            response = alice.post("/api/knowledge/upload", files={"files": (name, content)}).json()
            assert response["code"] != 0 and reason in response["msg"], response
        assert len(envelope(alice.post("/api/knowledge/list/page", json={})) ["records"]) == 2
        after = collection.get(ids=old["ids"], include=["documents", "metadatas", "embeddings"])
        assert before["documents"] == after["documents"] and before["metadatas"] == after["metadatas"]
        assert (before["embeddings"] == after["embeddings"]).all()
        report.update(status="PASS", chunkCount=row["chunkCount"], embeddingDimension=1024,
            collection="diagnosis-knowledge", checks=["python-login-and-anonymous-denial",
                "binary-doc-chinese-tables-header-footer-upload-and-citations", "real-chroma-chunks-and-integer-metadata",
                "large-owner-id-cross-user-denial", "corrupt-empty-encrypted-inputs-no-index",
                "original-document-vector-and-dimension-preserved"])


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--redis-server")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"timestampUtc": datetime.now(timezone.utc).isoformat(), "status": "NOT_RUN",
        "embedding": "CONTROLLED", "realEmbedding": "BLOCKED (historical HTTP 401; not rerun)",
        "cos": "CONTROLLED", "clinical": "NOT_VERIFIED", "javaStarted": False}
    try:
        execute(args, report)
    except Exception as error:
        report.update(status="FAIL", error=type(error).__name__, locations=[
            {"file": Path(frame.filename).name, "line": frame.lineno}
            for frame in traceback.extract_tb(error.__traceback__)])
    (args.output_dir / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

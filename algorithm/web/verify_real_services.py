"""Issue 19 isolated real-service acceptance; exit 0 PASS, 1 FAIL, 2 BLOCKED.

Requires REAL_SERVICES_MYSQL_ADMIN_URL (local MySQL, no database component).
Owns a fresh schema and child processes; never falls back to SQLite.
"""

import argparse
import asyncio
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import traceback
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

ROOT = Path(__file__).resolve().parents[2]


class Blocked(RuntimeError):
    pass


def gate(status, detail):
    return {"status": status, "detail": detail}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--embedding-mode", choices=["real", "controlled"], default="real")
    parser.add_argument("--cutover-nginx", help="Opt in to isolated Nginx cutover/rollback rehearsal (absolute binary path)")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {"timestampUtc": datetime.now(timezone.utc).isoformat(), "status": "BLOCKED",
        "checks": [], "gates": {
            "infrastructure": gate("BLOCKED", "Real MySQL/Redis/Chroma/Java not exercised"),
            "realEmbedding": gate("BLOCKED", "Real embedding has not been exercised"),
            "realClassifier": gate("NOT_VERIFIED", "Deterministic classifier only; no model weight acceptance"),
            "realLLM": gate("NOT_VERIFIED", "Deterministic chat/explanation only"),
            "realCOS": gate("NOT_VERIFIED", "Local file adapter only"),
            "clinical": gate("NOT_VERIFIED", "Synthetic accounts and documents; no clinical acceptance")}}
    try:
        value = os.getenv("REAL_SERVICES_MYSQL_ADMIN_URL")
        if not value:
            raise Blocked("REAL_SERVICES_MYSQL_ADMIN_URL is required")
        target = make_url(value)
        if (target.drivername != "mysql+pymysql" or target.database or
                target.host not in {"127.0.0.1", "localhost"}):
            raise Blocked("Use local mysql+pymysql admin URL without a database; a new schema is mandatory")
        execute(args, target, report)
        report["status"] = "PASS" if all(report["gates"][name]["status"] == "PASS"
            for name in ("realEmbedding", "legacyJavaReader")) else "BLOCKED"
    except Blocked as exc:
        report["reason"] = str(exc)
    except Exception as exc:
        # Do not serialize exception text: SQL/HTTP errors may contain secrets.
        report["status"] = "FAIL"
        report["reason"] = f"{type(exc).__name__}; inspect the private runtime logs"
        report["errorLocation"] = [{"file": Path(frame.filename).name, "line": frame.lineno}
                                   for frame in traceback.extract_tb(exc.__traceback__)]
    (args.output_dir / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return {"PASS": 0, "FAIL": 1, "BLOCKED": 2}[report["status"]]


def execute(args, target, report):
    redis = os.getenv("REAL_SERVICES_REDIS_SERVER") or shutil.which("redis-server")
    chroma = shutil.which("chroma", path=str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", ""))
    if not redis or not Path(redis).is_file() or not chroma:
        raise Blocked("redis-server and the locked Python chroma CLI are required; set REAL_SERVICES_REDIS_SERVER")
    if args.cutover_nginx and (not Path(args.cutover_nginx).is_file() or not (ROOT / "frontend/dist/index.html").is_file()):
        raise Blocked("Cutover requires an existing Nginx binary and built frontend/dist")
    env = os.environ.copy()
    if os.name == "nt":
        env["JAVA_HOME"] = r"C:\Users\yuwen\.jdks\corretto-21.0.7"
    java_home = Path(env.get("JAVA_HOME", ""))
    suffix = ".exe" if os.name == "nt" else ""
    java, javac = java_home / "bin" / ("java" + suffix), java_home / "bin" / ("javac" + suffix)
    if not java.is_file() or not javac.is_file():
        raise Blocked("JDK 21 JAVA_HOME is required")
    env["PATH"] = str(java_home / "bin") + os.pathsep + env.get("PATH", "")
    maven = shutil.which("mvn", path=env["PATH"])
    if not maven:
        raise Blocked("Maven is required")
    schema = "eye_real_services_issue19_" + uuid4().hex
    runtime = ROOT / ".scratch/baseline-runtime" / schema
    runtime.mkdir(parents=True)
    report["schema"] = schema
    report["runtime"] = str(runtime)
    report["sourceCommit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    sources = [*(ROOT / "algorithm/web").rglob("*.py"),
               *(ROOT / "src/main/java").rglob("*.java"),
               *(ROOT / "deploy/workflow-migrations").rglob("*.sql"),
               ROOT / "pom.xml", ROOT / "deploy/real-services/Issue19Probe.java"]
    if args.cutover_nginx:
        sources.extend([ROOT / "deploy/mime.types", ROOT / "deploy/snippets/eye-proxy-headers.conf",
            ROOT / "frontend/src/composables/useAgentStream.ts", *(ROOT / "frontend/dist").rglob("*.*")])
    manifest = {file.relative_to(ROOT).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)}
    (args.output_dir / "source-sha256.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    real_embedding = args.embedding_mode == "real" and bool(env.get("DASHSCOPE_API_KEY"))
    report["embeddingMode"] = "real" if real_embedding else "controlled"
    if not real_embedding:
        report["gates"]["realEmbedding"] = gate("BLOCKED", "DASHSCOPE_API_KEY missing or controlled mode requested; controlled vectors only")
    else:
        from web.vectorstore import DashScopeEmbedder, VectorStoreUnavailable

        async def probe_embedding():
            async with httpx.AsyncClient(timeout=30) as client:
                return await DashScopeEmbedder(env["DASHSCOPE_API_KEY"],
                    env.get("REAL_SERVICES_EMBEDDING_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
                    "text-embedding-v3", client=client).embed(["glaucoma overview"])

        try:
            vectors = asyncio.run(probe_embedding())
            assert len(vectors[0]) > 0
        except (httpx.HTTPError, VectorStoreUnavailable) as exc:
            real_embedding = False
            report["embeddingMode"] = "controlled"
            detail = "Real provider unavailable; controlled vectors only"
            if "HTTP 401" in str(exc):
                detail = "Real DashScope preflight returned HTTP 401; controlled vectors only"
            report["gates"]["realEmbedding"] = gate("BLOCKED", detail)

    def run(name, command, cwd=ROOT, command_env=None, timeout=240):
        report["stage"] = name
        result = subprocess.run([str(c) for c in command], cwd=cwd, env=command_env or env,
            capture_output=True, timeout=timeout)
        (runtime / (name + ".log")).write_bytes(result.stdout + result.stderr)
        assert result.returncode == 0, f"{name} failed; inspect private log"
        report["checks"].append(name)
        print(name + ": PASS", flush=True)

    admin = create_engine(target, isolation_level="AUTOCOMMIT", connect_args={"connect_timeout": 5})
    try:
        with admin.connect() as db:
            report["mysqlVersion"] = db.exec_driver_sql("SELECT VERSION()").scalar_one()
            db.exec_driver_sql(f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            db.exec_driver_sql(f"USE `{schema}`")
            ddl = (ROOT / "src/main/resources/db/schema.sql").read_text(encoding="utf-8")
            for name in ("t_user", "t_news", "t_knowledge_document"):
                match = re.search(rf"CREATE TABLE IF NOT EXISTS {name}\s*\(.*?;", ddl, re.S)
                assert match is not None
                db.exec_driver_sql(match.group())
    except OperationalError as exc:
        raise Blocked("Local MySQL is unavailable or admin credentials were rejected") from exc
    finally:
        admin.dispose()
    db_url = target.set(database=schema)
    env.update(FLYWAY_URL=f"jdbc:mysql://{target.host}:{target.port or 3306}/{schema}?serverTimezone=Asia/Shanghai",
               FLYWAY_USER=target.username or "", FLYWAY_PASSWORD=target.password or "")
    for action in ("migrate", "validate"):
        run("flyway-" + action, [maven, "-B", "-f", "deploy/workflow-migrations/pom.xml", "flyway:" + action])
    run("java-compile", [maven, "-B", "-DskipTests", "compile", "dependency:build-classpath",
        "-Dmdep.outputFile=" + str(runtime / "classpath.txt")])
    classpath = str(ROOT / "target/classes") + os.pathsep + (runtime / "classpath.txt").read_text().strip()
    run("java-probe-compile", [javac, "-encoding", "UTF-8", "-cp", classpath, "-d", runtime,
        ROOT / "deploy/real-services/Issue19Probe.java"])
    engine = create_engine(db_url, connect_args={"init_command": "SET time_zone = '+08:00'"})
    password = secrets.token_urlsafe(24)
    import bcrypt

    with engine.begin() as db:
        for i, (account, role) in enumerate((("alice", "user"), ("bob", "user"), ("doctor", "doctor"), ("admin", "admin"))):
            db.execute(text("INSERT INTO t_user(id,userAccount,userPassword,userName,userRole) VALUES (:id,:account,:password,:name,:role)"),
                {"id": 8 if account == "bob" else 9007199254740993 + i,
                 "password": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
                 "name": "Issue19 " + account, "role": role, "account": "issue19_" + account})
        db.execute(text("INSERT INTO t_news(id,title,userId,content,summary,coverImg,status,publishTime) VALUES "
            "(9007199254741000,'Issue19',9007199254740996,:content,:summary,'https://issue19.invalid/cover.png',1,'2026-01-02 10:00:00')"),
            {"content": "Synthetic news for compatibility regression only.", "summary": "Synthetic news for compatibility"})
    redis_port, chroma_port, java_port, api_port, provider_port = [free_port() for _ in range(5)]
    env.update(MYSQL_HOST=target.host or "127.0.0.1", MYSQL_PORT=str(target.port or 3306), MYSQL_DATABASE=schema,
        MYSQL_USER=target.username or "", MYSQL_PASSWORD=target.password or "", REDIS_HOST="127.0.0.1", REDIS_PORT=str(redis_port),
        REDIS_DB="8", REDIS_PASSWORD="", CHROMA_HOST="http://127.0.0.1", CHROMA_PORT=str(chroma_port),
        CHROMA_COLLECTION="diagnosis-knowledge", CHROMA_TENANT="default_tenant", CHROMA_DATABASE="default_database",
        DASHSCOPE_BASE_URL=f"http://127.0.0.1:{provider_port}/v1",
        REAL_SERVICES_TRACE=str(runtime / "calls.jsonl"), REAL_SERVICES_OBJECTS=str(runtime / "objects"),
        REAL_SERVICES_EMBEDDING="real" if real_embedding else "controlled", MODEL_WEIGHTS_PATH="", MODEL_WEIGHTS_SHA256="",
        EMBEDDING_MODEL="text-embedding-v3", COS_HOST="https://issue19.invalid", MCP_ALLOWED_ORIGINS="",
        CORS_ALLOWED_ORIGINS="", CHAT_MODEL="issue19-controlled", QUALITY_GATE_MODE="observe")
    # Retain the genuine key only for embedding; no real chat/classification is called.
    if not real_embedding:
        env["DASHSCOPE_API_KEY"] = "issue19-controlled"
    spring = {"server.address": "127.0.0.1", "server.port": java_port, "spring.profiles.active": "issue19",
        "spring.datasource.url": env["FLYWAY_URL"], "spring.datasource.username": target.username,
        "spring.datasource.password": target.password, "spring.flyway.schemas": schema,
        "spring.session.store-type": "redis", "spring.data.redis.host": "127.0.0.1",
        "spring.data.redis.port": redis_port, "spring.data.redis.database": 8,
        "spring.ai.openai.api-key": "issue19-unused", "spring.ai.dashscope.api-key": env["DASHSCOPE_API_KEY"],
        "spring.ai.dashscope.embedding.options.model": "text-embedding-v3",
        "spring.ai.vectorstore.chroma.client.host": "http://127.0.0.1", "spring.ai.vectorstore.chroma.client.port": chroma_port,
        "spring.ai.vectorstore.chroma.collection-name": "diagnosis-knowledge",
        "spring.ai.vectorstore.chroma.tenant-name": "default_tenant", "spring.ai.vectorstore.chroma.database-name": "default_database",
        "cos.client.host": "https://issue19.invalid", "cos.client.secretId": "issue19-unused",
        "cos.client.secretKey": "issue19-unused", "cos.client.region": "ap-guangzhou", "cos.client.bucket": "issue19-unused",
        "spring.jackson.date-format": "yyyy-MM-dd HH:mm:ss", "spring.jackson.serialization.write-dates-as-timestamps": False,
        "eye-diagnosis.rag.rerank.enabled": False, "eye-diagnosis.rag.hybrid-search.enabled": False,
        "eye-diagnosis.rag.search.similarity-threshold": 0.0,
        "issue19.controlled-embedding": not real_embedding,
        "logging.level.org.springframework.ai.chat.client.advisor.SimpleLoggerAdvisor": "OFF"}
    java_env = {**env, "SPRING_APPLICATION_JSON": json.dumps(spring)}
    children = []

    def start(name, command, child_env=env, url=None):
        log = (runtime / (name + ".log")).open("wb")
        child = subprocess.Popen([str(c) for c in command], cwd=ROOT / "algorithm", env=child_env,
            stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        children.append((child, log))
        report.setdefault("processes", []).append({"role": name, "pid": child.pid})
        if url:
            wait_http(child, url)
        return child

    def worker(mode="pass"):
        run("worker-" + mode + "-" + uuid4().hex[:6], [sys.executable, "-m", "web.tests.real_services_process", "worker", "--mode", mode], ROOT / "algorithm")

    proxy = None
    try:
        start("redis", [redis, "--bind", "127.0.0.1", "--port", redis_port, "--save", "", "--appendonly", "no", "--dir", runtime])
        start("chroma", [chroma, "run", "--host", "127.0.0.1", "--port", chroma_port, "--path", runtime / "chroma"],
            url=f"http://127.0.0.1:{chroma_port}/api/v2/heartbeat")
        import chromadb
        from redis import Redis

        store = chromadb.HttpClient(host="127.0.0.1", port=chroma_port)
        collection = store.get_or_create_collection("diagnosis-knowledge")
        redis_client = Redis(host="127.0.0.1", port=redis_port, db=8, protocol=2)
        assert redis_client.ping()
        report["redisVersion"] = redis_client.info()["redis_version"]
        report["chromaVersion"] = store.get_version()
        report["chromaPackageVersion"] = chromadb.__version__
        start("provider", [sys.executable, "-m", "web.tests.real_services_process", "provider", "--port", provider_port],
            url=f"http://127.0.0.1:{provider_port}/health")
        java_child = start("java", [java, "-Xmx512m", "-cp", str(runtime) + os.pathsep + classpath, "Issue19Probe"], java_env,
            f"http://127.0.0.1:{java_port}/api/user/get/login")
        start("api", [sys.executable, "-m", "web.tests.real_services_process", "api", "--port", api_port],
            url=f"http://127.0.0.1:{api_port}/health")
        report["gates"]["infrastructure"] = gate("PASS", "Fresh Flyway MySQL schema; real Redis, Chroma and Java startup after V22")
        front_port = api_port
        if args.cutover_nginx:
            from web.cutover_rehearsal import Proxy

            proxy = Proxy(args.cutover_nginx, runtime, java_port, api_port)
            proxy.switch("java", "java", "pause")
            front_port = proxy.port
            report["gates"]["cutover"] = gate("BLOCKED", "Nginx rehearsal not yet completed")
        with ExitStack() as stack:
            clients = {account: stack.enter_context(httpx.Client(base_url=f"http://127.0.0.1:{front_port}", timeout=60))
                       for account in ("alice", "bob", "doctor", "admin")}
            for account, client in clients.items():
                login_url = f"http://127.0.0.1:{api_port}/api/user/login"
                envelope(client.post(login_url, json={"userAccount": "issue19_" + account, "userPassword": password}))
                assert "EYE_SESSION" in client.cookies
            assert redis_client.keys("eye:py:session:*")
            assert not redis_client.keys("spring:session:sessions:*")
            report["checks"].append("python-session-namespace-without-spring-session-writes")
            # Java remains a separate historical compatibility oracle. Its
            # cookies never supply identity to the Python application.
            legacy = {account: stack.enter_context(httpx.Client(base_url=f"http://127.0.0.1:{java_port}", timeout=60))
                      for account in clients}
            for account, client in legacy.items():
                envelope(client.post("/api/user/login", json={"userAccount": "issue19_" + account, "userPassword": password}))
            if proxy:
                proxy.switch("python", "java", "pause")
                envelope(clients["alice"].get("/api/user/get/login"))
                envelope(clients["alice"].post("/api/news/list/page/vo", json={}))
                proxy.switch("python", "python", "active")
            verify_http(clients, java_port, engine, collection, worker, report, proxy=proxy, legacy_clients=legacy)
            if proxy:
                proxy.verify_agent_rollback(clients["alice"], report)
                from web.cutover_browser import verify_browser

                verify_browser(proxy, password, runtime, worker, report)
                report["gates"]["cutover"] = gate("PASS", "Isolated real Nginx/MySQL/Java/API/Worker; controlled models; pending save/reviews preserved; browser exercised")
            # Revoke the Python Redis session and replay the old cookie.
            alice = clients["alice"]
            old_cookies = dict(alice.cookies)
            envelope(alice.post("/api/user/logout"))
            alice.cookies.update(old_cookies)
            envelope(alice.get("/api/user/get/login"), code=40100)
            envelope(alice.post("/api/diagnosis/list/page/my", json={}), code=40100)
            assert alice.get("/api/diagnosis/workflows/unknown/events").status_code == 401
            report["checks"].append("python-logout-old-cookie-revoked-in-python-and-sse")
            for account, client in clients.items():
                if account == "alice":
                    continue  # Already revoked; old-cookie replay is intentional.
                envelope(client.post("/api/user/logout"))
            for client in legacy.values():
                envelope(client.post("/api/user/logout"))
        assert java_child.poll() is None
        calls = [json.loads(line) for line in (runtime / "calls.jsonl").read_text().splitlines()]
        report["adapterCalls"] = {kind: sum(c["kind"] == kind for c in calls) for kind in sorted({c["kind"] for c in calls})}
        assert report["adapterCalls"]["inference"] == (5 if proxy else 4)
        assert report["adapterCalls"]["explanation"] == 3
        assert report["adapterCalls"]["chat"] == (4 if proxy else 3)
        if real_embedding:
            assert report["adapterCalls"].get("realEmbedding", 0) > 0
            report["gates"]["realEmbedding"] = gate("PASS", "Real DashScope upload/query plus unchanged Java native embedder and Chroma reader")
        report["gates"]["orchestration"] = gate("PASS", "Production API/MySQL/Worker/graph with deterministic classification and LLM")
    finally:
        if proxy:
            proxy.close()
        for child, log in reversed(children):
            stop_child(child)
            log.close()
        engine.dispose()
    # Reuse the opt-in subprocess suites for transaction/lease/fencing/restart coverage.
    # Each creates its own fresh, guarded schema and labels its external adapters.
    for suite in ("worker-concurrency", "human-wait-restart"):
        run(suite, [sys.executable, "-m", "web.verify_worker_concurrency", "--suite", suite,
            "--output-dir", runtime / suite], ROOT / "algorithm",
            {**env, "WORKER_TEST_MYSQL_ADMIN_URL": target.render_as_string(hide_password=False)}, timeout=360)
    report["gates"]["mysqlSemantics"] = gate("PASS", "Real MySQL subprocess competition, leases, fencing, version conflicts and durable restart suites")


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def stop_child(child):
    if child.poll() is not None:
        return
    if os.name == "nt":
        # The venv/console-script launcher can own another Python process.
        # Kill only this child PID and descendants created by this runner.
        subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], capture_output=True, timeout=15)
    else:
        child.terminate()
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=10)


def wait_http(child, url):
    deadline = time.monotonic() + 100
    with httpx.Client(timeout=2) as client:
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise Blocked("Service process exited during startup; inspect private runtime log")
            try:
                if client.get(url).status_code == 200:
                    return
            except httpx.TransportError:
                pass
            time.sleep(.2)
    raise Blocked("Service startup timed out; inspect private runtime log")


def envelope(response, *, code=0, status=200):
    assert response.status_code == status, f"HTTP {response.status_code}, expected {status}"
    body = response.json()
    assert set(body) == {"code", "msg", "data"}
    assert body["code"] == code, f"Business code {body['code']}, expected {code}"
    return body["data"]


def verify_http(clients, java_port, engine, collection, worker, report, *, proxy=None, legacy_clients):
    import io
    from docx import Document
    from PIL import Image
    from web.workflow.definition import ACTION_VERSION, GRAPH_HASH, GRAPH_VERSION

    alice, bob, doctor, admin = [clients[name] for name in ("alice", "bob", "doctor", "admin")]
    java_url = f"http://127.0.0.1:{java_port}/api"
    check = report["checks"].append
    with httpx.Client(base_url=str(alice.base_url)) as anonymous:
        envelope(anonymous.post("/api/diagnosis/list/page/my", json={}), code=40100)
        assert anonymous.post("/api/diagnosis/workflows", data={"idempotencyKey": "anon"},
            files={"file": ("x.png", b"invalid", "image/png")}).status_code == 401
    envelope(alice.post("/api/user/list/page/vo", json={}), code=40101)
    users = envelope(admin.post("/api/user/list/page/vo/cache", json={"pageSize": 3}))
    assert all(isinstance(users[k], str) for k in ("total", "size", "current", "pages"))
    assert "userPassword" not in json.dumps(users)
    assert envelope(admin.get("/api/user/get", params={"id": "9007199254740993"}))["id"] == "9007199254740993"
    check("real-python-auth-and-user-role-long-pagination-contracts")
    for endpoint in ("list/page/vo", "list/page/vo/cache", "list/page/my"):
        assert envelope(alice.post("/api/diagnosis/" + endpoint, json={"userId": "9007199254740994"}))["total"] == "0"
    envelope(alice.post("/api/diagnosis/diagnosis", files={"file": ("x.png", b"invalid", "image/png")}), code=50000)
    assert envelope(alice.post("/api/diagnosis/list/page/my", json={}))["total"] == "0"
    check("legacy-synchronous-diagnosis-fails-closed-without-model")
    news_id = "9007199254741000"
    for endpoint in ("list/page/vo", "list/page/vo/cache"):
        page = envelope(alice.post("/api/news/" + endpoint, json={"pageSize": 3}))
        assert page["records"][0]["id"] == news_id and page["total"] == "1"
    py_news = envelope(alice.get("/api/news/get/" + news_id))
    java_news = envelope(legacy_clients["alice"].get(java_url + "/news/get/" + news_id))
    assert py_news == java_news
    body = {"id": news_id, "title": "Issue19", "content": "Synthetic news for compatibility regression only.", "status": 1}
    py_noop = admin.post("/api/news/edit", json=body)
    java_noop = legacy_clients["admin"].post(java_url + "/news/edit", json=body)
    assert py_noop.status_code == java_noop.status_code == 200
    assert py_noop.json()["code"] == java_noop.json()["code"]
    with engine.begin() as db:
        affected = db.execute(text("UPDATE t_news SET title=title WHERE id=:id"), {"id": int(news_id)}).rowcount
    report["affectedRows"] = {"sqlalchemyNoopRowcount": affected,
        "pythonNoopCode": py_noop.json()["code"], "javaNoopCode": java_noop.json()["code"]}
    check("real-mysql-noop-affected-rows-and-java-news-date-contract")

    def table_doc(text_value):
        document = Document()
        document.add_table(rows=1, cols=1).cell(0, 0).text = text_value
        output = io.BytesIO()
        document.save(output)
        return output.getvalue()

    reference = "Glaucoma is an eye condition that can affect the optic nerve."
    docx = table_doc(reference)

    def upload_document(client, name, content):
        ids = envelope(client.post("/api/knowledge/upload", files=[("files", (name, content, "application/octet-stream"))]))
        assert len(ids) == 1
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            docs = envelope(client.post("/api/knowledge/list/page", json={"pageSize": 50}))["records"]
            document = next(row for row in docs if row["id"] == ids[0])
            assert document["status"] != 2, "Document indexing failed"
            if document["status"] == 1:
                return document
            time.sleep(.1)
        raise AssertionError("Indexing timeout")

    public = upload_document(alice, "reference.docx", docx)
    legacy = upload_document(alice, "legacy.doc", (ROOT / "algorithm/web/tests/fixtures/documents/simple.doc").read_bytes())
    private = upload_document(bob, "private.docx", table_doc("Bob private sentinel glaucoma reference."))
    alice_docs = envelope(alice.post("/api/knowledge/list/page", json={}))["records"]
    assert {row["id"] for row in alice_docs} == {public["id"], legacy["id"]}
    citations = envelope(alice.post("/api/knowledge/search", json={"query": reference, "userId": "8"}))
    assert public["id"] in {c["documentId"] for c in citations}
    assert private["id"] not in {c["documentId"] for c in citations}
    assert all(c["source"] and c["quotedTextDigest"] and c["citationId"].startswith("doc_") for c in citations)
    vectors = collection.get(ids=[f'doc_{public["id"]}_chunk_0', f'doc_{legacy["id"]}_chunk_0'], include=["documents", "metadatas"])
    assert len(vectors["ids"]) == 2 and reference in vectors["documents"]
    assert all(type(m["ownerUserId"]) is int for m in vectors["metadatas"])
    java_result = legacy_clients["alice"].get(java_url + "/issue19/search", params={"query": reference})
    assert java_result.status_code == 200
    if reference in java_result.text:
        assert "Bob private sentinel" not in java_result.text
        report["gates"]["legacyJavaReader"] = gate("PASS", "Unchanged reader retrieved Python vectors for a Long owner ID")
    else:
        # Preserve the legacy bug boundary: Spring AI parses numeric filter literals
        # as int32. Do not patch original Java sources or silently reduce all IDs.
        log = Path(report["runtime"]) / "java.log"
        assert 'NumberFormatException: For input string: "9007199254740993"' in log.read_text(encoding="utf-8", errors="replace")
        report["gates"]["legacyJavaReader"] = gate("BLOCKED",
            "Original Spring AI filter parser rejects Long owner 9007199254740993 with NumberFormatException; Java sources preserved")
    bob_result = legacy_clients["bob"].get(java_url + "/issue19/search", params={"query": "Bob private sentinel glaucoma reference."})
    assert bob_result.status_code == 200 and "Bob private sentinel" in bob_result.text
    assert reference not in bob_result.text
    check("doc-and-table-docx-http-indexing-real-chroma-private-scope-and-legacy-java-reader")
    governance = {"visibility": "CURATED_PUBLIC", "reviewStatus": "APPROVED", "diseaseCodes": ["glaucoma"],
        "topicCodes": ["DISEASE_OVERVIEW"], "expectedVersion": 0, "confirmed": True}
    govern_url = "/api/knowledge/admin/documents/" + public["id"]
    envelope(admin.patch(govern_url, json=governance))
    assert admin.patch(govern_url, json=governance).status_code == 409
    envelope(alice.patch(govern_url, json=governance), code=40101)
    check("governance-role-and-real-mysql-version-conflict")

    image = io.BytesIO()
    Image.new("RGB", (32, 32), "red").save(image, format="PNG")
    picture = image.getvalue()

    def start(key, content=picture):
        response = alice.post("/api/diagnosis/workflows", data={"idempotencyKey": key, "question": "Synthetic acceptance image"},
            files={"file": ("fundus.png", content, "image/png")})
        return envelope(response, status=202)["workflowId"]

    def state(task):
        return envelope(alice.get("/api/diagnosis/workflows/" + task))

    task = start("pass")
    assert start("pass") == task
    conflict = alice.post("/api/diagnosis/workflows", data={"idempotencyKey": "pass"},
        files={"file": ("changed.png", b"different", "image/png")})
    assert conflict.status_code == 409
    assert bob.get("/api/diagnosis/workflows/" + task).status_code == 403
    worker()
    view = state(task)
    assert view["status"] == "COMPLETED" and view["explanation"]["publicationStatus"] == "PUBLISHED"
    published_ids = {citation["documentId"] for citation in view["result"]["citations"]}
    assert published_ids == {public["id"]}
    before = state(task)
    worker()
    assert state(task) == before
    events = alice.get(f"/api/diagnosis/workflows/{task}/events")
    assert events.status_code == 200 and "event: done" in events.text and task in events.text
    assert bob.get(f"/api/diagnosis/workflows/{task}/events").status_code == 403
    check("production-registered-graph-worker-checkpoint-citations-and-sse-readback")
    report["graph"] = {"version": GRAPH_VERSION, "hash": GRAPH_HASH, "actionVersion": ACTION_VERSION,
        "completedNodes": view["progress"]["completed"]}

    save_url = f"/api/diagnosis/workflows/{task}/save-confirmation"
    save_request = {"idempotencyKey": "save", "expectedWorkflowVersion": view["workflowVersion"],
        "expectedExplanationSnapshotId": view["explanation"]["snapshotId"],
        "expectedExplanationRevision": view["explanation"]["revision"]}
    confirmation = envelope(alice.post(save_url, json=save_request))
    assert confirmation["status"] == "PENDING"
    if proxy:
        proxy.preserve_wait(alice, save_url, report)
    assert envelope(alice.post("/api/diagnosis/list/page/my", json={}))["total"] == "0"
    approve_url = f'/api/diagnosis/workflows/{task}/save-confirmations/{confirmation["confirmationId"]}/approve'
    decision = {"idempotencyKey": confirmation["idempotencyKey"], "expectedContentDigest": confirmation["contentDigest"],
        "expectedWorkflowVersion": confirmation["workflowVersion"]}
    assert bob.post(approve_url, json=decision).status_code == 403
    assert doctor.post(approve_url, json=decision).status_code == 403
    assert alice.post(approve_url, json={**decision, "expectedContentDigest": "0" * 64}).status_code == 409
    approved = envelope(alice.post(approve_url, json=decision))
    assert approved["status"] == "APPROVED"
    assert envelope(alice.post(approve_url, json=decision)) == approved
    history = envelope(alice.post("/api/diagnosis/list/page/my", json={"pageSize": 3}))
    java_history = envelope(legacy_clients["alice"].post(java_url + "/diagnosis/list/page/my", json={"pageSize": 3}))
    assert history["total"] == java_history["total"] == "1"
    for key in ("id", "createTime"):
        assert history["records"][0][key] == java_history["records"][0][key]
    assert envelope(bob.post("/api/diagnosis/list/page/my", json={"userId": "9007199254740993"}))["total"] == "0"
    check("user-consent-only-save-conflict-and-replay-exactly-once-java-python-history-parity")

    def review(mode):
        reviewed = start(mode)
        worker(mode)
        assert state(reviewed)["status"] == "WAITING_HUMAN_REVIEW"
        assert alice.get("/api/reviews/tasks").status_code == 403
        tasks = envelope(doctor.get("/api/reviews/tasks"))
        row = next(r for r in tasks if r["workflowId"] == reviewed)
        url = "/api/reviews/tasks/" + row["reviewTaskId"]
        detail = envelope(doctor.get(url))
        if proxy:
            proxy.preserve_wait(doctor, url, report)

        def versions(detail):
            result = {"expectedTaskVersion": detail["taskVersion"], "expectedWorkflowVersion": detail["workflowVersion"]}
            if mode == "final":
                result.update(expectedExplanationSnapshotId=detail["explanation"]["snapshotId"],
                    expectedExplanationRevision=detail["explanation"]["revision"])
            return result

        old = versions(detail)
        envelope(doctor.post(url + "/claim", json=old))
        detail = envelope(doctor.get(url))
        assert doctor.post(url + "/claim", json=old).status_code == 409
        body = {**versions(detail), "decisionCode": "APPROVE_CONTINUE" if mode == "quality" else "CONFIRM_AI_ASSESSMENT",
            "reasonCode": "QUALITY_APPROVED" if mode == "quality" else "AI_ASSESSMENT_CONFIRMED"}
        envelope(doctor.post(url + "/submit", json=body))
        envelope(doctor.post(url + "/submit", json=body))
        worker()
        assert state(reviewed)["status"] == "COMPLETED"
        assert envelope(alice.post("/api/diagnosis/list/page/my", json={}))["total"] == "1"
        return reviewed

    quality, final = review("quality"), review("final")
    check("real-java-doctor-quality-and-final-review-versions-without-implicit-save")
    invalid = start("invalid", b"invalid-image")
    worker()
    assert (state(invalid)["status"], state(invalid)["stopReasonCode"]) == ("REJECTED", "INVALID_IMAGE")
    # Revoking the only public source causes the normal graph's bounded insufficient path.
    envelope(admin.patch(govern_url, json={**governance, "expectedVersion": 1, "reviewStatus": "WITHDRAWN"}))
    limited = start("limited")
    worker()
    assert state(limited)["status"] == "COMPLETED_LIMITED" and state(limited)["result"] is None
    report["terminalStates"] = {key: state(value)["status"] for key, value in
        {"publishedThenRevoked": task, "qualityReview": quality, "finalReview": final, "invalid": invalid, "insufficient": limited}.items()}
    check("invalid-and-insufficient-terminal-paths-and-source-revocation")

    for index, message in enumerate(("hello", "issue19-history", "issue19-provider-error")):
        sid = "issue19-chat-" + str(index)
        response = alice.post("/api/agent/chat/stream", json={"threadId": sid, "message": message, "disableMcpDefault": True})
        assert response.status_code == 200 and "text/event-stream" in response.headers["content-type"]
        if index == 2:
            assert "event: error" in response.text
        else:
            assert "event: done" in response.text
        if index == 1:
            assert approved["diagnosisId"] in response.text and "已保存诊断记录" in response.text
        envelope(alice.get("/api/agent/history/" + sid))
        envelope(bob.get("/api/agent/history/" + sid), code=40101)
    sessions = envelope(alice.get("/api/agent/sessions"))
    assert len(sessions) == 3
    check("legacy-agent-sse-success-error-and-readonly-history-with-real-auth-and-mysql")
    if proxy:
        proxy.verify_supplement(alice, task, report)


if __name__ == "__main__":
    sys.exit(main())

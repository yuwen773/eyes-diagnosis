"""Ticket06: isolated real MySQL/Redis/Chroma, Python API/Worker acceptance.

Creates only random local schemas; retains evidence and data. Providers are
separate gates. Historical issue19 results are never overwritten.
"""

import argparse
import asyncio
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import os
from pathlib import Path
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

ROOT = Path(__file__).resolve().parents[2]


class Blocked(RuntimeError):
    pass


def gate(status, detail):
    return {"status": status, "detail": detail}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--embedding-mode", choices=["real", "controlled"], default="controlled")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {"ticket": "06", "timestampUtc": datetime.now(timezone.utc).isoformat(), "status": "BLOCKED",
              "checks": [], "gates": {name: gate("NOT_VERIFIED", "Separate acceptance boundary") for name in
              ["infrastructure", "orchestration", "mysqlSemantics", "realEmbedding", "realClassifier", "realLLM", "realCOS", "clinical"]}}
    for name in ("infrastructure", "orchestration", "mysqlSemantics"):
        report["gates"][name] = gate("BLOCKED", "Required infrastructure verification has not completed")
    try:
        value = os.getenv("REAL_SERVICES_MYSQL_ADMIN_URL")
        if not value:
            raise Blocked("REAL_SERVICES_MYSQL_ADMIN_URL is required")
        target = make_url(value)
        if target.drivername != "mysql+pymysql" or target.database or target.host not in {"127.0.0.1", "localhost"}:
            raise Blocked("Use a local MySQL admin URL without a database")
        execute(args, target, report)
        report["status"] = "PASS_WITH_LIMITATIONS"
    except Blocked as exc:
        report["reason"] = str(exc)
    except Exception as exc:
        report["status"] = "FAIL"
        report["reason"] = type(exc).__name__ + "; inspect private runtime logs"
        report["errorLocation"] = [{"file": Path(f.filename).name, "line": f.lineno} for f in traceback.extract_tb(exc.__traceback__)]
    (args.output_dir / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return {"PASS_WITH_LIMITATIONS": 0, "FAIL": 1, "BLOCKED": 2}[report["status"]]


def execute(args, target, report):
    redis = os.getenv("REAL_SERVICES_REDIS_SERVER") or shutil.which("redis-server")
    if not redis or not Path(redis).is_file():
        raise Blocked("Set REAL_SERVICES_REDIS_SERVER to an installed Redis executable")
    env = os.environ.copy()
    env.pop("JAVA_HOME", None)
    if os.name == "nt":
        env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + str(Path(os.environ["SystemRoot"]) / "System32")
    schema = "eye_python_issue06_" + uuid4().hex
    runtime = ROOT / ".scratch/baseline-runtime" / schema
    runtime.mkdir(parents=True)
    report.update(schema=schema, runtime=str(runtime))
    admin = create_engine(target)
    with admin.begin() as db:
        report["mysqlVersion"] = db.exec_driver_sql("SELECT VERSION()").scalar_one()
        db.exec_driver_sql(f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    admin.dispose()
    env["MIGRATION_MYSQL_URL"] = target.set(database=schema).render_as_string(hide_password=False)

    def run(name, command, child_env=env, timeout=360):
        result = subprocess.run([str(c) for c in command], cwd=ROOT / "algorithm", env=child_env,
                                capture_output=True, timeout=timeout)
        (runtime / (name + ".log")).write_bytes(result.stdout + result.stderr)
        assert result.returncode == 0, name + " failed; inspect private logs"

    run("python-upgrade", [sys.executable, "-m", "web.migrations", "upgrade"])
    run("python-inspect", [sys.executable, "-m", "web.migrations", "inspect"])
    engine = create_engine(target.set(database=schema))
    password = secrets.token_urlsafe(24)
    from web.security import encode
    with engine.begin() as db:
        for i, (account, role) in enumerate((("alice", "user"), ("bob", "user"), ("doctor", "doctor"), ("admin", "admin"))):
            db.execute(text("INSERT INTO t_user(id,userAccount,userPassword,userName,userRole) VALUES (:id,:account,:password,:name,:role)"),
                {"id": 8 if account == "bob" else 9007199254740993 + i, "account": "issue19_" + account,
                 "password": encode(password), "name": "Acceptance " + account, "role": role})
        db.execute(text("INSERT INTO t_news(id,title,userId,content,summary,coverImg,status,publishTime) VALUES "
            "(9007199254741000,'Issue19',9007199254740996,:content,:summary,'https://issue19.invalid/cover.png',1,'2026-01-02 10:00:00')"),
            {"content": "Synthetic news for compatibility regression only.", "summary": "Synthetic news for compatibility"})
    real_embedding = False
    if args.embedding_mode == "real":
        key = os.getenv("DASHSCOPE_API_KEY", "").strip()
        if key:
            try:
                from web.vectorstore import DashScopeEmbedder
                asyncio.run(DashScopeEmbedder(key, os.getenv("REAL_SERVICES_EMBEDDING_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
                                              "text-embedding-v3").embed(["acceptance preflight"]))
                real_embedding = True
            except Exception:
                report["gates"]["realEmbedding"] = gate("BLOCKED", "Provider preflight failed; controlled vectors used")
        else:
            report["gates"]["realEmbedding"] = gate("BLOCKED", "Missing credentials; controlled vectors used")
    redis_port, chroma_port, api_port, provider_port = [free_port() for _ in range(4)]
    env.update(MYSQL_HOST=target.host, MYSQL_PORT=str(target.port or 3306), MYSQL_DATABASE=schema,
        MYSQL_USER=target.username or "", MYSQL_PASSWORD=target.password or "", REDIS_HOST="127.0.0.1", REDIS_PORT=str(redis_port),
        REDIS_DB="8", REDIS_PASSWORD="", CHROMA_HOST="127.0.0.1", CHROMA_PORT=str(chroma_port),
        CHROMA_COLLECTION="diagnosis-knowledge", CHROMA_TENANT="default_tenant", CHROMA_DATABASE="default_database",
        DASHSCOPE_BASE_URL=f"http://127.0.0.1:{provider_port}/v1", REAL_SERVICES_TRACE=str(runtime / "calls.jsonl"),
        REAL_SERVICES_OBJECTS=str(runtime / "objects"), REAL_SERVICES_EMBEDDING="real" if real_embedding else "controlled",
        MODEL_WEIGHTS_PATH="", MODEL_WEIGHTS_SHA256="", EMBEDDING_MODEL="text-embedding-v3", COS_HOST="https://issue19.invalid",
        MCP_ALLOWED_ORIGINS="", CORS_ALLOWED_ORIGINS="", CHAT_MODEL="qwen3-vl-plus", QUALITY_GATE_MODE="observe",
        SESSION_COOKIE_NAME="EYE_SESSION", SESSION_COOKIE_SECURE="false", SESSION_REDIS_PREFIX="eye:py:session:")
    if not real_embedding:
        env["DASHSCOPE_API_KEY"] = "controlled-acceptance"
    with ExitStack() as stack:
        stack.callback(engine.dispose)

        def start(name, command, url=None):
            log = stack.enter_context((runtime / (name + "-" + uuid4().hex[:6] + ".log")).open("wb"))
            child = subprocess.Popen([str(c) for c in command], cwd=ROOT / "algorithm", env=env,
                                     stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            stack.callback(stop_child, child)
            report.setdefault("processes", []).append({"role": name, "pid": child.pid})
            if url:
                wait_http(child, url)
            return child

        start("redis", [redis, "--bind", "127.0.0.1", "--port", redis_port, "--save", "", "--appendonly", "no", "--dir", runtime])
        start("chroma", [sys.executable, "-c", "from chromadb.cli.cli import app; app()", "run", "--host", "127.0.0.1", "--port", chroma_port,
                         "--path", runtime / "chroma"], f"http://127.0.0.1:{chroma_port}/api/v2/heartbeat")
        import chromadb
        from redis import Redis
        store = chromadb.HttpClient(host="127.0.0.1", port=chroma_port)
        collection = store.get_or_create_collection("diagnosis-knowledge")
        redis_client = Redis(host="127.0.0.1", port=redis_port, db=8, protocol=2)
        stack.callback(redis_client.close)
        assert redis_client.ping()
        report["redisVersion"] = redis_client.info()["redis_version"]
        report["chromaVersion"] = store.get_version()
        start("provider", [sys.executable, "-m", "web.tests.real_services_process", "provider", "--port", provider_port],
              f"http://127.0.0.1:{provider_port}/health")
        api_command = [sys.executable, "-m", "web.tests.real_services_process", "api", "--port", api_port]
        api_child = start("api", api_command, f"http://127.0.0.1:{api_port}/ready")

        def restart_api():
            nonlocal api_child
            stop_child(api_child)
            api_child = start("api-restart", api_command, f"http://127.0.0.1:{api_port}/ready")

        def worker(mode="pass"):
            run("worker-" + mode + "-" + uuid4().hex[:6],
                [sys.executable, "-m", "web.tests.real_services_process", "worker", "--mode", mode])

        clients = {account: stack.enter_context(httpx.Client(base_url=f"http://127.0.0.1:{api_port}", timeout=150, trust_env=False))
                   for account in ("alice", "bob", "doctor", "admin")}
        for account, client in clients.items():
            envelope(client.post("/api/user/login", json={"userAccount": "issue19_" + account, "userPassword": password}))
            assert "EYE_SESSION" in client.cookies
        assert redis_client.keys("eye:py:session:*") and not redis_client.keys("spring:session:sessions:*")
        report["gates"]["infrastructure"] = gate("PASS", "Python migration, real MySQL/Redis/Chroma, independent API/Worker")
        verify_http(clients, engine, collection, worker, report, restart_api)
        alice = clients["alice"]
        old = dict(alice.cookies)
        envelope(alice.post("/api/user/logout"))
        alice.cookies.update(old)
        envelope(alice.get("/api/user/get/login"), code=40100)
        assert alice.get("/api/diagnosis/workflows/unknown/events").status_code == 401
        report["checks"].append("real-redis-logout-cookie-replay-and-sse-revocation")
        report["gates"]["orchestration"] = gate("PASS", "Production graph, durable restart, human waits, exactly-once explicit save; controlled model/COS/LLM")
        if real_embedding:
            report["gates"]["realEmbedding"] = gate("PASS", "Real provider upload/query and Python large-ID owner filtering")
    for suite in ("worker-concurrency", "human-wait-restart"):
        run(suite, [sys.executable, "-m", "web.verify_worker_concurrency", "--suite", suite, "--output-dir", runtime / suite],
            {**env, "WORKER_TEST_MYSQL_ADMIN_URL": target.render_as_string(hide_password=False)}, timeout=600)
    report["gates"]["mysqlSemantics"] = gate("PASS", "Real MySQL leases/fencing/transactions/concurrency and cross-process human wait recovery")


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


def verify_http(clients, engine, collection, worker, report, restart_api):
    import io
    from docx import Document
    from PIL import Image
    from web.workflow.definition import ACTION_VERSION, GRAPH_HASH, GRAPH_VERSION

    alice, bob, doctor, admin = [clients[name] for name in ("alice", "bob", "doctor", "admin")]
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
    # The deliberate unhandled model failure makes Uvicorn close the connection
    # after returning the frozen error envelope. Do not race reuse of that socket.
    envelope(alice.post("/api/diagnosis/diagnosis", headers={"Connection": "close"},
                        files={"file": ("x.png", b"invalid", "image/png")}), code=50000)
    assert envelope(alice.post("/api/diagnosis/list/page/my", json={}))["total"] == "0"
    check("legacy-synchronous-diagnosis-fails-closed-without-model")
    news_id = "9007199254741000"
    for endpoint in ("list/page/vo", "list/page/vo/cache"):
        page = envelope(alice.post("/api/news/" + endpoint, json={"pageSize": 3}))
        assert page["records"][0]["id"] == news_id and page["total"] == "1"
    py_news = envelope(alice.get("/api/news/get/" + news_id))
    assert py_news["id"] == news_id and py_news["publishTime"] == "2026-01-02 02:00:00"
    body = {"id": news_id, "title": "Issue19", "content": "Synthetic news for compatibility regression only.", "status": 1}
    envelope(admin.post("/api/news/edit", json=body))
    with engine.begin() as db:
        affected = db.execute(text("UPDATE t_news SET title=title WHERE id=:id"), {"id": int(news_id)}).rowcount
    report["affectedRows"] = {"sqlalchemyNoopRowcount": affected}
    check("real-mysql-noop-and-frozen-news-date-contract")

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
    bob_citations = envelope(bob.post("/api/knowledge/search", json={"query": reference}))
    assert public["id"] not in {c["documentId"] for c in bob_citations}
    check("doc-docx-real-chroma-large-id-private-scope")
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
    restart_api()
    assert envelope(alice.get(save_url)) == confirmation
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
    assert history["total"] == "1"
    assert isinstance(history["records"][0]["id"], str)
    assert envelope(bob.post("/api/diagnosis/list/page/my", json={"userId": "9007199254740993"}))["total"] == "0"
    check("user-consent-save-conflict-and-replay-exactly-once")

    def review(mode):
        reviewed = start(mode)
        worker(mode)
        assert state(reviewed)["status"] == "WAITING_HUMAN_REVIEW"
        assert alice.get("/api/reviews/tasks").status_code == 403
        tasks = envelope(doctor.get("/api/reviews/tasks"))
        row = next(r for r in tasks if r["workflowId"] == reviewed)
        url = "/api/reviews/tasks/" + row["reviewTaskId"]
        detail = envelope(doctor.get(url))
        restart_api()
        assert envelope(doctor.get(url)) == detail

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
    check("real-python-doctor-quality-and-final-review-versions-without-implicit-save")
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



if __name__ == "__main__":
    raise SystemExit(main())

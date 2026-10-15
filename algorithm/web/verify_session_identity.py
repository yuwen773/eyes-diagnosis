"""Ticket 02: isolated real MySQL/Redis, TCP API and original Vue; never Java.

Set REAL_SERVICES_MYSQL_ADMIN_URL to a local mysql+pymysql URL without a
database. Only a newly created eye_session_issue02_* schema is modified.
Credentials, password hashes and cookies are excluded from the JSON report.
"""

import argparse
import hashlib
from contextlib import ExitStack
from datetime import datetime, timezone
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

import httpx
from redis import Redis
from sqlalchemy import create_engine, update
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from web.models.diagnosis import Diagnosis
from web.models.news import News
from web.models.user import User
from web.security import encode
from web.verify_real_services import envelope, free_port, stop_child, wait_http
from web.workflow.definition import ACTION_VERSION, GRAPH_HASH, GRAPH_VERSION
from web.workflow.models import UploadInput, Workflow

ROOT = Path(__file__).resolve().parents[2]
ALICE, BOB = 9007199254740993, 9007199254740994
DIAGNOSIS_ID, NEWS_ID = 9007199254741001, 9007199254741002
COOKIE, PREFIX = "EYE_SESSION", "eye:py:session:"


def execute(args, report):
    raw = os.environ.get("REAL_SERVICES_MYSQL_ADMIN_URL")
    redis_binary = args.redis_server or shutil.which("redis-server")
    if not raw or not redis_binary or not Path(redis_binary).is_file():
        report["reason"] = "Local MySQL admin URL and redis-server executable are required"
        return
    target = make_url(raw)
    if target.drivername != "mysql+pymysql" or target.database or target.host not in {"localhost", "127.0.0.1"}:
        raise ValueError("Only a local MySQL admin URL without a database is allowed")
    schema = "eye_session_issue02_" + uuid4().hex
    report["schema"] = schema
    runtime = ROOT / ".scratch/baseline-runtime" / schema
    runtime.mkdir(parents=True)
    report["runtime"] = str(runtime)
    admin = create_engine(target)
    try:
        with admin.begin() as db:
            report["mysqlVersion"] = db.exec_driver_sql("SELECT VERSION()").scalar_one()
            db.exec_driver_sql(f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    finally:
        admin.dispose()
    env = os.environ.copy()
    env["MIGRATION_MYSQL_URL"] = target.set(database=schema).render_as_string(hide_password=False)
    migration = subprocess.run([sys.executable, "-m", "web.migrations", "upgrade"],
        cwd=ROOT / "algorithm", env=env, capture_output=True, timeout=180)
    assert migration.returncode == 0, "Isolated Python migration failed"
    report["migration"] = json.loads(migration.stdout)
    engine = create_engine(target.set(database=schema))
    password = secrets.token_urlsafe(24)
    now = datetime(2026, 1, 1, 12)
    with Session(engine) as db:
        for user_id, account in ((ALICE, "session_alice"), (BOB, "session_bob")):
            stored = encode(password).replace("$2b$", "$2a$") if user_id == ALICE else hashlib.md5(("yuwen" + password).encode()).hexdigest()
            db.add(User(id=user_id, user_account=account, user_password=stored,
                user_name=account, user_role="user", edit_time=now, create_time=now, update_time=now))
        for owner, record in ((ALICE, DIAGNOSIS_ID), (BOB, DIAGNOSIS_ID + 10)):
            db.add(Diagnosis(id=record, user_id=owner, url="/synthetic-session-history.png",
                result="normal", confidence=.75, create_time=now, severity="NOT_ASSESSED", ai_rejected=0))
        db.add(News(id=NEWS_ID, user_id=ALICE, title="隔离身份验证文章",
            content="合成资料，仅验证登录后的原数据读取。", cover_img="", status=1,
            publish_time=now, edit_time=now))
        db.add(Workflow(workflow_id="session-owned", owner_user_id=ALICE,
            idempotency_key="session-owned", status="FAILED", stop_reason="MODEL_UNAVAILABLE",
            graph_version=GRAPH_VERSION, graph_hash=GRAPH_HASH, action_version=ACTION_VERSION))
        db.add(UploadInput(workflow_id="session-owned", request_digest="0" * 64, image_bytes=b"synthetic"))
        db.commit()
    redis_port, api_port, frontend_port = free_port(), free_port(), free_port()
    api = f"http://127.0.0.1:{api_port}"
    frontend = f"http://127.0.0.1:{frontend_port}"
    env.update(MYSQL_HOST=target.host, MYSQL_PORT=str(target.port or 3306), MYSQL_DATABASE=schema,
        MYSQL_USER=target.username or "", MYSQL_PASSWORD=target.password or "",
        REDIS_HOST="127.0.0.1", REDIS_PORT=str(redis_port), REDIS_DB="0", REDIS_PASSWORD="",
        SESSION_COOKIE_NAME=COOKIE, SESSION_REDIS_PREFIX=PREFIX, SESSION_TTL_SECONDS="1800",
        SESSION_COOKIE_SECURE="false", SESSION_COOKIE_HTTPONLY="true", SESSION_COOKIE_SAMESITE="lax",
        CORS_ALLOWED_ORIGINS=frontend, VITE_API_BASE_URL=api + "/api", VITE_AGENT_BASE_URL=api,
        MODEL_WEIGHTS_PATH="", DASHSCOPE_API_KEY="", COS_SECRET_ID="", COS_SECRET_KEY="")
    checks = report["checks"]
    with ExitStack() as stack:
        stack.callback(engine.dispose)

        def start(name, command, cwd=ROOT / "algorithm", url=None):
            log = stack.enter_context((runtime / (name + ".log")).open("wb"))
            child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            stack.callback(stop_child, child)
            if url:
                wait_http(child, url)
            return child

        redis_child = start("redis", [str(redis_binary), "--bind", "127.0.0.1", "--port", str(redis_port),
            "--save", "", "--appendonly", "no", "--dir", str(runtime)])
        redis = Redis(host="127.0.0.1", port=redis_port, decode_responses=True, protocol=2)
        stack.callback(redis.close)
        deadline = time.monotonic() + 15
        while True:
            try:
                assert redis.ping()
                break
            except ConnectionError:
                raise
            except Exception:
                assert time.monotonic() < deadline and redis_child.poll() is None
                time.sleep(.1)
        report["redisVersion"] = redis.info("server")["redis_version"]
        start("api", [sys.executable, "-m", "uvicorn", "web.app:app", "--host", "127.0.0.1",
            "--port", str(api_port), "--no-access-log"], url=api + "/health")
        clients = [stack.enter_context(httpx.Client(base_url=api, timeout=20, trust_env=False)) for _ in range(3)]
        alice, bob, anonymous = clients

        def login(client, account="session_alice"):
            user = envelope(client.post("/api/user/login", json={"userAccount": account, "userPassword": password}))
            assert "userPassword" not in user and user["id"] == str(ALICE if account == "session_alice" else BOB)
            assert COOKIE in client.cookies
            return client.cookies[COOKIE]

        def protected_denied(client, code=40100, status=401):
            envelope(client.post("/api/diagnosis/list/page/my", json={}), code=code)
            envelope(client.post("/api/agent/chat/stream", json={"threadId": "identity", "message": "hello"}), code=code)
            assert client.get("/api/diagnosis/workflows/unknown/events").status_code == status

        protected_denied(anonymous)
        anonymous.cookies.update({"SESSION": "legacy", "JSESSIONID": "legacy"})
        protected_denied(anonymous)
        checks.append("anonymous-and-spring-cookies-denied-http-and-sse")
        old_sid = login(alice)
        new_sid = login(alice)
        assert old_sid != new_sid and not redis.exists(PREFIX + old_sid)
        assert redis.ttl(PREFIX + new_sid) > 0
        assert json.loads(redis.get(PREFIX + new_sid)) == {"userId": str(ALICE)}
        redis.expire(PREFIX + new_sid, 1)
        envelope(alice.get("/api/user/get/login"))
        assert redis.ttl(PREFIX + new_sid) > 1
        assert not redis.keys("spring:session:sessions:*")
        checks.append("bcrypt-login-rotation-cookie-and-independent-redis-namespace")
        login(bob, "session_bob")
        with Session(engine) as db:
            assert db.get(User, BOB).user_password.startswith("$2")
        checks.append("legacy-md5-password-upgraded-over-tcp")
        records = envelope(alice.post("/api/diagnosis/list/page/my", json={"userId": str(BOB)}))
        assert [r["id"] for r in records["records"]] == [str(DIAGNOSIS_ID)]
        assert [r["id"] for r in envelope(bob.post("/api/diagnosis/list/page/my", json={}))["records"]] == [str(DIAGNOSIS_ID + 10)]
        envelope(bob.get(f"/api/diagnosis/get/{DIAGNOSIS_ID}"), code=40101)
        stream = alice.get("/api/diagnosis/workflows/session-owned/events")
        assert stream.status_code == 200 and "event: state" in stream.text and "event: done" in stream.text
        assert bob.get("/api/diagnosis/workflows/session-owned/events").status_code == 403
        assert envelope(alice.get(f"/api/news/get/{NEWS_ID}"))["id"] == str(NEWS_ID)
        checks.append("original-stable-long-ids-history-news-and-second-user-isolation")
        envelope(alice.post("/api/user/logout"))
        alice.cookies.set(COOKIE, new_sid, domain="127.0.0.1", path="/")
        protected_denied(alice)
        checks.append("logout-and-cookie-replay-denied")
        login(alice)
        with engine.begin() as db:
            db.execute(update(User).where(User.id == ALICE).values(is_delete=1))
        protected_denied(alice)
        with engine.begin() as db:
            db.execute(update(User).where(User.id == ALICE).values(is_delete=0, user_role="admin"))
        envelope(alice.post("/api/user/list/page/vo", json={}))
        with engine.begin() as db:
            db.execute(update(User).where(User.id == ALICE).values(user_role="user"))
        envelope(alice.post("/api/user/list/page/vo", json={}), code=40101)
        checks.append("logical-delete-and-role-change-revalidated-each-request")
        sid = login(alice)
        redis.expire(PREFIX + sid, 1)
        deadline = time.monotonic() + 5
        while redis.exists(PREFIX + sid):
            assert time.monotonic() < deadline
            time.sleep(.1)
        protected_denied(alice)
        checks.append("real-redis-ttl-expiry-denied-http-and-sse")
        report["infrastructure"] = "PASS"

        start("frontend", [shutil.which("node"), "node_modules/vite/bin/vite.js", "--host", "127.0.0.1",
            "--port", str(frontend_port), "--strictPort"], cwd=ROOT / "frontend", url=frontend)
        verify_browser(frontend, api, password, redis, args.output_dir, report)
        login(alice)
        stop_child(redis_child)
        protected_denied(alice, code=50000, status=500)
        envelope(alice.post("/api/user/login", json={"userAccount": "session_alice", "userPassword": password}), code=50000)
        checks.append("stopped-redis-fails-closed-on-login-http-and-sse")
        report["status"] = "PASS"


def verify_browser(frontend, api, password, redis, output, report):
    from playwright.sync_api import expect, sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000})

            def login():
                page.goto(frontend + "/user/login", wait_until="networkidle")
                page.get_by_placeholder("请输入账号", exact=True).fill("session_alice")
                page.get_by_placeholder("请输入密码", exact=True).fill(password)
                with page.expect_response(lambda r: r.url.endswith("/api/user/login") and r.request.method == "POST") as response:
                    page.locator("button.login-button").click()
                assert response.value.json()["code"] == 0
                page.wait_for_url(frontend + "/")
                page.wait_for_load_state("networkidle")

            def history():
                page.goto(frontend + "/user/userCenter/profile", wait_until="networkidle")
                with page.expect_response(lambda r: "/api/diagnosis/list/page/vo/cache" in r.url) as response:
                    page.get_by_role("menuitem", name="诊断历史").click()
                data = response.value.json()
                assert data["code"] == 0
                assert [row["id"] for row in data["data"]["records"]] == [str(DIAGNOSIS_ID)]
                page.wait_for_load_state("networkidle")

            login()
            history()
            page.screenshot(path=str(output / "vue-original-history.png"), full_page=True)
            page.locator(".avatar-dropdown__trigger").click()
            with page.expect_response(lambda r: r.url.endswith("/api/user/logout")) as response:
                page.get_by_text("退出登录", exact=True).click()
            assert response.value.json()["code"] == 0
            page.wait_for_url(frontend + "/user/login")
            page.screenshot(path=str(output / "vue-logout.png"), full_page=True)
            login()
            sid = next(c["value"] for c in page.context.cookies() if c["name"] == COOKIE)
            redis.expire(PREFIX + sid, 1)
            deadline = time.monotonic() + 5
            while redis.exists(PREFIX + sid):
                assert time.monotonic() < deadline
                time.sleep(.1)
            # The existing Axios 40100 interceptor redirects protected reads.
            page.goto(frontend + "/user/userCenter/profile", wait_until="networkidle")
            page.get_by_role("menuitem", name="诊断历史").click()
            page.wait_for_url("**/user/login**")
            expect(page.get_by_placeholder("请输入账号", exact=True)).to_be_visible()
            page.screenshot(path=str(output / "vue-expiry-guidance.png"), full_page=True)
            report["browser"] = "PASS"
            report["checks"].append("original-vue-login-history-logout-and-expiry-guidance")
        finally:
            browser.close()


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--redis-server")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"timestampUtc": datetime.now(timezone.utc).isoformat(), "status": "NOT_RUN",
        "infrastructure": "NOT_RUN", "browser": "NOT_RUN", "javaStarted": False,
        "realModel": "NOT_RUN", "clinical": "NOT_RUN", "checks": []}
    try:
        execute(args, report)
    except Exception as error:
        report["status"] = "FAIL"
        report["reason"] = type(error).__name__
        report["errorLocation"] = [{"file": Path(frame.filename).name, "line": frame.lineno}
                                  for frame in traceback.extract_tb(error.__traceback__)]
    (args.output_dir / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "PASS" else 2 if report["status"] == "NOT_RUN" else 1


if __name__ == "__main__":
    raise SystemExit(main())

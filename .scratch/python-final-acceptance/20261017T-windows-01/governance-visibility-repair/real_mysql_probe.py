"""Synthetic governance only: original API entry, isolated MySQL/Redis, no providers."""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

import httpx
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from acceptance_runtime import Owned, envelope, free_port, save, wait_http
from acceptance_observe import observe
from accept_python_migration import check_ports
from web.models.knowledge import KnowledgeDocument
from web.models.user import User
from web.security import encode
from web.tests.handoff_fixtures import isolated_database


def main():
    directory = Path(__file__).resolve().parent
    run = directory.parent
    check_ports()
    before = observe(run)
    save(directory / "business-before.json", before)
    raw = os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"]
    target = make_url(raw)
    if target.database:
        raise ValueError("Use a local admin URL without a database")
    url, schema = isolated_database(raw)
    save(directory / "probe-manifest.json", {"schema": schema,
        "scope": "Synthetic governance fixtures; never participant-approved documents",
        "apiEntry": "scripts/run_service.py api", "apiPort": 8080,
        "providerRequests": 0, "retainedSchema": True})
    env = {key: value for key, value in os.environ.items() if key.upper() in {
        "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE",
        "HOMEDRIVE", "HOMEPATH", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PATHEXT", "PATH"}}
    redis_port = free_port()
    env.update(PYTHONPATH=str(ROOT / "algorithm"), PYTHONUNBUFFERED="1",
        MYSQL_HOST=target.host, MYSQL_PORT=str(target.port or 3306), MYSQL_USER=target.username,
        MYSQL_PASSWORD=target.password or "", MYSQL_DATABASE=schema, MIGRATION_MYSQL_URL=url,
        REDIS_HOST="127.0.0.1", REDIS_PORT=str(redis_port), REDIS_DB="8", REDIS_PASSWORD="",
        WEB_HOST="127.0.0.1", WEB_PORT="8080", SESSION_COOKIE_SECURE="false")
    migrated = subprocess.run([sys.executable, "-m", "web.migrations", "upgrade"],
        cwd=ROOT / "algorithm", env=env, capture_output=True, timeout=120)
    migration_output = (migrated.stdout + migrated.stderr).decode("utf-8", errors="replace")
    for secret in (raw, target.password):
        if secret:
            migration_output = migration_output.replace(secret, "[REDACTED]")
    (directory / "migration.log").write_text(migration_output, encoding="utf-8")
    if migrated.returncode:
        raise RuntimeError("Isolated explicit migration failed")
    password = secrets.token_urlsafe(24)
    engine = create_engine(url)
    owned = Owned(directory, [raw, target.password, password])
    report = {"status": "FAIL", "schema": schema, "checks": [], "providerRequests": 0,
        "scope": "Real MySQL/Redis and original API, synthetic fixtures; no human acceptance"}
    try:
        now = datetime.now()
        with Session(engine) as db:
            db.add_all([User(id=9007199254740993, user_account="governance-admin", user_password=encode(password),
                user_name="Synthetic administrator", user_role="admin", create_time=now,
                edit_time=now, update_time=now, is_delete=0)])
            for doc_id in range(1, 21):
                db.add(KnowledgeDocument(id=doc_id, user_id=9007199254740993,
                    title=f"Synthetic governance {doc_id}", file_name=f"controlled-{doc_id}.txt",
                    file_url=f"https://fixture.invalid/{doc_id}.txt", file_type="txt", status=1,
                    chunk_count=1, visibility="PRIVATE_USER", review_status="PENDING", disease_codes=[],
                    topic_codes=[], governance_version=0, create_time=now, update_time=now, is_delete=0))
            db.commit()
        redis_dir = directory / "redis"
        redis_dir.mkdir(exist_ok=True)
        owned.start("redis", ["D:/Work/Backend/Redis-x64-3.2.100/redis-server.exe", "--bind", "127.0.0.1",
            "--port", redis_port, "--dir", redis_dir, "--appendonly", "no", "--save", ""], env)
        api = owned.start("api", [sys.executable, ROOT / "scripts/run_service.py", "api"], env)
        wait_http(api, "http://127.0.0.1:8080/health")
        with httpx.Client(base_url="http://127.0.0.1:8080", trust_env=False, timeout=10) as writer, \
             httpx.Client(base_url="http://127.0.0.1:8080", trust_env=False, timeout=10) as reader:
            envelope(writer.post("/api/user/login", json={"userAccount": "governance-admin", "userPassword": password}))
            reader.cookies.update(writer.cookies)
            bodies = {}
            for doc_id in range(1, 21):
                body = {"visibility": "CURATED_PUBLIC", "reviewStatus": "APPROVED", "diseaseCodes": ["myopia"],
                    "topicCodes": ["DISEASE_OVERVIEW"], "expectedVersion": 0, "confirmed": True}
                updated = envelope(writer.patch(f"/api/knowledge/admin/documents/{doc_id}", json=body))
                # No retry/sleep/poll: a separate connection reads immediately after success.
                rows = envelope(reader.post("/api/knowledge/admin/documents", json={"pageSize": 100}))["records"]
                row = next(row for row in rows if row["id"] == str(doc_id))
                assert row["governanceVersion"] == updated["governanceVersion"] == 1
                assert (row["reviewStatus"], row["visibility"], row["diseaseCodes"]) == (
                    "APPROVED", "CURATED_PUBLIC", ["myopia"])
                report["checks"].append({"documentId": str(doc_id), "version": 1,
                    "immediateIndependentRead": "PASS", "polling": False})
                bodies[doc_id] = body
            stale = writer.patch("/api/knowledge/admin/documents/20", json=bodies[20])
            assert stale.status_code == 409
            report["staleVersionConflict"] = "PASS"
            # Hard stop only the registered process tree, then read durable state with the same login cookie.
            owned.stop(api)
            restarted = owned.start("api-restart", [sys.executable, ROOT / "scripts/run_service.py", "api"], env)
            wait_http(restarted, "http://127.0.0.1:8080/health")
            with httpx.Client(base_url="http://127.0.0.1:8080", trust_env=False, timeout=10,
                              cookies=reader.cookies) as after_restart:
                rows = envelope(after_restart.post("/api/knowledge/admin/documents", json={"pageSize": 100}))["records"]
                assert len(rows) == 20
                assert all(row["governanceVersion"] == 1 and row["reviewStatus"] == "APPROVED" for row in rows)
                report["durableAfterApiRestart"] = "PASS"
        report["status"] = "PASS"
    finally:
        owned.close()
        engine.dispose()
        report["cleanup"] = "PASS"
        after = observe(run)
        save(directory / "business-after.json", after)
        assert before["sha256"] == after["sha256"], "Participant workflow tables changed"
        report["participantBusinessTablesUnchanged"] = list(before["sha256"])
        report["sourceSha256"] = hashlib.sha256((ROOT / "algorithm/web/routers/knowledge.py").read_bytes()).hexdigest()
        save(directory / "real-mysql-result.json", report)
    print(json.dumps({key: value for key, value in report.items() if key not in {"checks", "participantBusinessTablesUnchanged"}}))


if __name__ == "__main__":
    main()

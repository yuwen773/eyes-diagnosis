"""Ticket 07 opt-in first-cutover rehearsal. Only owned local synthetic data.

Run with CUTOVER_NGINX, CUTOVER_JAVA, CUTOVER_LEGACY_JAR,
CUTOVER_LEGACY_SOURCE_ZIP, CUTOVER_MYSQL_BIN, HANDOFF_TEST_MYSQL_ADMIN_URL,
WAIT_RECOVERY_REDIS_SERVER and CUTOVER_EVIDENCE_DIR. Provider IO is controlled.
The old Java artifact is only exercised before Python writes are reopened.
"""

from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from uuid import uuid4
import zipfile
from typing import Any

import httpx
import pytest
import numpy as np
from redis import Redis
from sqlalchemy import select
from sqlalchemy.engine import make_url

from web.migrations.runner import connect, data_snapshot, query
from web.models.news import News
from web.tests.handoff_fixtures import isolated_database
from web.tests.human_wait_process import REFERENCE
from web.tests.test_chat_workflow import send
from web.tests.test_final_clinical_review import final_versions
from web.tests.test_human_wait_restart import restart_case, start, view
from web.tests.test_maintenance import command
from web.tests.test_python_wait_recovery import (
    recovery_runtime, recovery_case, login, signed_api, sample, upgrade, state_event,
)
from web.tests.test_quality_review import versions
from web.tests.test_save_confirmation import act, path, requested
from web.tests.test_supplement import reply, request_supplement, supplement_event
from web.tests.test_workflow import create_upload, picture_bytes
from web.tests.test_worker_concurrency import executor
from web.verify_real_services import free_port, stop_child, wait_http
from web.workflow.models import Job, Workflow

ROOT = Path(__file__).resolve().parents[3]
RELEASE = "5733cf33823257e8be2aa1ad2c3fd13e7b5754f0"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(url):
    with connect(url) as db:
        return data_snapshot(db)


@contextmanager
def child(command_line, directory, name, *, env=None, health=None):
    with (directory / (name + ".log")).open("wb") as log:
        process = subprocess.Popen(command_line, cwd=ROOT, env=env, stdout=log, stderr=log,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            if health:
                wait_http(process, health)
            yield process
        finally:
            stop_child(process)


class Gateway:
    def __init__(self, directory, legacy_port, artifact):
        self.directory = directory / "gateway"
        self.directory.mkdir()
        self.ports = [free_port(), legacy_port, free_port()]
        self.address = f"http://127.0.0.1:{self.ports[0]}"
        self.artifact = artifact
        self.process = None
        self.sequence = 0

    def switch(self, route, policy):
        args = command(self.directory, route, policy, self.ports)
        args[args.index("--artifact-sha256") + 1] = self.artifact[route]
        result = subprocess.run(args, capture_output=True)
        if result.returncode:
            return result
        if self.process:
            stop_child(self.process)
        config = self.directory / "nginx.conf"
        launch = [os.environ["CUTOVER_NGINX"], "-p", self.directory.as_posix() + "/", "-c", config.as_posix()]
        checked = subprocess.run([*launch, "-t"], capture_output=True)
        (self.directory / f"syntax-{self.sequence}.log").write_bytes(checked.stdout + checked.stderr)
        assert checked.returncode == 0
        self.sequence += 1
        self.process = subprocess.Popen(launch, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        wait_http(self.process, self.address + "/health")
        return result

    def close(self):
        if self.process:
            stop_child(self.process)


def legacy_environment(url, redis_url, port, chroma_port):
    target = make_url(url)
    redis = make_url(redis_url)
    return {**os.environ, "SPRING_APPLICATION_JSON": json.dumps({
        "server.address": "127.0.0.1", "server.port": port,
        "server.servlet.context-path": "/api", "spring.profiles.active": "cutover07",
        "spring.main.lazy-initialization": True, "spring.flyway.enabled": False,
        "spring.datasource.url": f"jdbc:mysql://127.0.0.1:{target.port}/{target.database}?serverTimezone=Asia/Shanghai",
        "spring.datasource.username": target.username, "spring.datasource.password": target.password,
        "spring.data.redis.host": "127.0.0.1", "spring.data.redis.port": redis.port,
        "spring.data.redis.database": 0, "spring.session.store-type": "redis",
        "spring.ai.openai.api-key": "isolated-unused", "spring.ai.dashscope.api-key": "isolated-unused",
        "spring.ai.vectorstore.chroma.client.host": "http://127.0.0.1",
        "spring.ai.vectorstore.chroma.client.port": chroma_port,
        "spring.ai.vectorstore.chroma.collection-name": "diagnosis-knowledge",
        "spring.ai.vectorstore.chroma.tenant-name": "default_tenant",
        "spring.ai.vectorstore.chroma.database-name": "default_database",
        "cos.client.host": "https://fixture.invalid", "cos.client.secretId": "unused",
        "cos.client.secretKey": "unused", "cos.client.region": "ap-guangzhou", "cos.client.bucket": "unused",
        "eye-diagnosis.agent.outbox.enabled": False,
        "mybatis-plus.configuration.log-impl": "org.apache.ibatis.logging.nologging.NoLoggingImpl",
    })}


def mysql_backup(url, directory):
    target = make_url(url)
    assert target.database and target.host in {"localhost", "127.0.0.1"}
    assert target.database.startswith("eye_human_wait_issue17_")
    with connect(url) as db:
        assert all(row["Engine"] == "InnoDB" for row in query(db, "SHOW TABLE STATUS"))
    binary = Path(os.environ["CUTOVER_MYSQL_BIN"])
    env = {**os.environ, "MYSQL_PWD": target.password or ""}
    arguments = ["--host=127.0.0.1", "--port=" + str(target.port), "--user=" + str(target.username)]
    with (directory / "mysql.sql").open("wb") as output:
        result = subprocess.run([str(binary / "mysqldump.exe" if os.name == "nt" else binary / "mysqldump"),
            *arguments, "--single-transaction", "--routines", "--events", "--hex-blob",
            "--set-gtid-purged=OFF", "--no-tablespaces", target.database],
            env=env, stdout=output, stderr=subprocess.PIPE)
    assert result.returncode == 0, "Owned schema backup failed; inspect private evidence"
    # Restore into a different newly created schema, never over the source.
    clone_url, clone_name = isolated_database(target.set(database=None).render_as_string(hide_password=False))
    result = subprocess.run([str(binary / "mysql.exe" if os.name == "nt" else binary / "mysql"),
        *arguments, clone_name], input=(directory / "mysql.sql").read_bytes(), env=env, capture_output=True)
    assert result.returncode == 0, "Isolated backup restore failed"
    assert snapshot(clone_url) == snapshot(url)
    return {"file": "mysql.sql", "sha256": sha(directory / "mysql.sql"), "restoreSchema": clone_name}


def prepare_waits(case, url):
    waits = {}
    with signed_api(case) as client:
        for kind in ("quality", "final", "save", "supplement"):
            login(client, "alice")
            workflow = start(client)
            case.worker(kind if kind in {"quality", "final"} else "pass")
            original = view(client, workflow)
            thread = "cutover07-" + kind
            assert "event: done" in send(client, thread=thread, workflowId=workflow).text
            if kind == "save":
                wait = client.post(path(workflow), json=requested(original)).json()["data"]
                wait_path = path(workflow)
            elif kind == "supplement":
                wait = supplement_event(request_supplement(client, workflow, thread=thread))
                wait_path = "/api/agent/supplements/" + wait["requestId"]
            else:
                login(client, "doctor")
                wait = next(row for row in client.get("/api/reviews/tasks").json()["data"]
                            if row["workflowId"] == workflow)
                wait_path = "/api/reviews/tasks/" + wait["reviewTaskId"]
                wait = client.get(wait_path).json()["data"]
            sample(case, url, kind, workflow, wait)
            waits[kind] = {"workflow": workflow, "wait": wait, "path": wait_path,
                           "state": original, "effects": case.effects(workflow)}
    return waits


def verify_waits(client, case, waits):
    for kind, item in waits.items():
        login(client, "alice")
        assert view(client, item["workflow"]) == item["state"]
        assert state_event(client, item["workflow"])["workflow"] == item["state"]
        login(client, "doctor" if kind in {"quality", "final"} else "alice")
        assert client.get(item["path"]).json()["data"] == item["wait"]
        assert case.effects(item["workflow"]) == item["effects"]


def test_first_cutover_prewrite_rollback_and_postwrite_forward_repair(recovery_case):
    required = ["CUTOVER_NGINX", "CUTOVER_JAVA", "CUTOVER_LEGACY_JAR", "CUTOVER_LEGACY_SOURCE_ZIP",
                "CUTOVER_MYSQL_BIN", "CUTOVER_EVIDENCE_DIR"]
    if not all(os.getenv(name) for name in required):
        pytest.skip("Opt-in ticket07 isolated Nginx/legacy-artifact/MySQL rehearsal")
    case, url = recovery_case
    output = Path(os.environ["CUTOVER_EVIDENCE_DIR"])
    output.mkdir(parents=True, exist_ok=True)
    directory = ROOT / ".scratch/baseline-runtime" / ("ticket07-" + uuid4().hex)
    directory.mkdir(parents=True)
    backup = directory / "backup"
    backup.mkdir()
    report: dict[str, Any] = {"status": "FAIL", "release": RELEASE, "runtime": str(directory),
              "schema": make_url(url).database, "checks": [], "production": "NOT_RUN",
              "providers": "NOT_VERIFIED", "clinical": "NOT_VERIFIED"}
    started = time.monotonic()
    legacy_jar = Path(os.environ["CUTOVER_LEGACY_JAR"])
    source_zip = Path(os.environ["CUTOVER_LEGACY_SOURCE_ZIP"])
    # Verify source provenance against Git, not the caller's label alone.
    archive = directory / "expected-source.zip"
    subprocess.run(["git", "archive", "--format=zip", "--output", str(archive), RELEASE, "src", "pom.xml"],
                   cwd=ROOT, check=True)
    assert sha(archive) == sha(source_zip)
    python_zip = directory / "python-release.zip"
    subprocess.run(["git", "archive", "--format=zip", "--output", str(python_zip), RELEASE,
                    "algorithm", "deploy", "contracts", "pyproject.toml", "scripts"], cwd=ROOT, check=True)
    python_source = directory / "python-release"
    with zipfile.ZipFile(python_zip) as frozen:
        frozen.extractall(python_source)
    artifacts = {"legacy": sha(legacy_jar), "python": sha(python_zip)}
    report["artifacts"] = {"legacyJarSha256": artifacts["legacy"], "legacySourceSha256": sha(source_zip),
                           "pythonArchiveSha256": artifacts["python"]}
    gateway = None
    try:
        waits = prepare_waits(case, url)
        now = datetime(2026, 1, 2, 10)
        with case.sessions.begin() as db:
            db.add(News(id=7007, user_id=7, title="保留的切换演练新闻", content="Synthetic retained content",
                        summary="Synthetic", cover_img="https://fixture.invalid/cover.png", status=1,
                        publish_time=now, edit_time=now))
            db.add(Workflow(workflow_id="java-wait07", owner_user_id=7, idempotency_key="java-key07",
                            status="WAITING_HUMAN_REVIEW", graph_version="java-release", graph_hash="old",
                            action_version="old", created_at=now))
            db.add(Job(job_id="java-job07", workflow_id="java-wait07", job_type="RESUME", segment_code="java-segment"))
        # One active lease finishes while admissions are closed; no loop claims
        # another job. All other Python jobs are persisted human waits.
        with signed_api(case) as direct:
            in_flight = start(direct)
            with executor(case.sessions, directory, "validate"):
                pass
        chroma_port = free_port()
        chroma_dir = directory / "chroma"
        chroma_command = [sys.executable, "-c", "from chromadb.cli.cli import app; app()", "run",
                          "--host", "127.0.0.1", "--port", str(chroma_port), "--path", str(chroma_dir)]
        heartbeat = f"http://127.0.0.1:{chroma_port}/api/v2/heartbeat"
        import chromadb
        with child(chroma_command, directory, "chroma-before", health=heartbeat):
            store = chromadb.HttpClient(host="127.0.0.1", port=chroma_port)
            collection = store.get_or_create_collection("diagnosis-knowledge")
            document_id = int(case.env["HUMAN_WAIT_DOCUMENT_ID"])
            collection.add(ids=[f"doc_{document_id}_chunk_0"], embeddings=np.zeros((1, 1024), dtype=np.float32),
                           documents=[REFERENCE],
                           metadatas=[{"ownerUserId": 7, "documentId": document_id, "docId": str(document_id)}])
            vector_before = collection.get(include=["documents", "metadatas", "embeddings"])
        # Chroma is stopped before copying its persistent files.
        shutil.copytree(chroma_dir, backup / "chroma")
        objects = directory / "objects"
        objects.mkdir()
        (objects / "input.png").write_bytes(picture_bytes())
        document_object = objects / f"{document_id}.txt"
        document_object.write_text(REFERENCE, encoding="utf-8")
        shutil.copytree(objects, backup / "objects")
        report["references"] = {"documentId": str(document_id), "ownerUserId": "7",
            "sourceUrl": f"https://fixture.invalid/{document_id}.txt", "object": document_object.name,
            "objectSha256": sha(document_object), "collection": "diagnosis-knowledge",
            "chunkId": f"doc_{document_id}_chunk_0", "embeddingDimensions": 1024,
            "workflowInputs": {item["workflow"]: "t_workflow_upload_input.imageBytes" for item in waits.values()}}
        # Allocate listeners immediately before starting the services. Earlier
        # sample/API processes must not reuse a port selected a minute ago.
        gateway = Gateway(directory, free_port(), artifacts)
        java_env = legacy_environment(url, case.env["WAIT_RECOVERY_REDIS_URL"], gateway.ports[1], chroma_port)
        with child([os.environ["CUTOVER_JAVA"], "-jar", str(legacy_jar)], directory, "legacy-before",
                   env=java_env, health=f"http://127.0.0.1:{gateway.ports[1]}/api/user/get/login"):
            with executor(case.sessions, directory, "draining", gated=True):
                maintenance_start = time.monotonic()
                assert gateway.switch("legacy", "readonly").returncode == 0
                with httpx.Client(base_url=gateway.address, timeout=30, trust_env=False) as client:
                    login(client, "alice")
                    assert client.post("/api/news/add", json={}).status_code == 503
                    assert client.post("/api/diagnosis/workflows").status_code == 503
                with case.sessions() as db:
                    job = db.scalar(select(Job).where(Job.workflow_id == in_flight, Job.status == "RUNNING"))
                    assert job is not None
                    report["drainedLease"] = {"workflowId": in_flight, "leaseVersion": job.lease_version,
                                              "tokenRecordedPrivately": True}
            # The owned once-only worker has exited; no daemon is claiming jobs.
            with case.sessions() as db:
                assert not list(db.scalars(select(Job).where(Job.status == "RUNNING")))
                ready = [row.job_id for row in db.scalars(select(Job).where(Job.status == "READY"))]
                assert ready
            time.sleep(.6)
            with case.sessions() as db:
                assert [row.job_id for row in db.scalars(select(Job).where(Job.status == "READY"))] == ready
            report["checks"].append("admissions-closed-active-lease-finished-new-claims-stopped")
            before = snapshot(url)
            report["beforeCutover"] = before
            report["mysqlBackup"] = mysql_backup(url, backup)
            redis = Redis.from_url(case.env["WAIT_RECOVERY_REDIS_URL"], protocol=2)
            try:
                redis.save()
                redis_directory = redis.config_get("dir")["dir"]
                assert isinstance(redis_directory, str)
                redis_runtime = Path(redis_directory)
                shutil.copyfile(redis_runtime / "dump.rdb", backup / "dump.rdb")
            finally:
                redis.close()
            report["backupFiles"] = {file.relative_to(backup).as_posix(): sha(file)
                                     for file in backup.rglob("*") if file.is_file()}
            assert snapshot(url) == before
            upgrade(case, url)
            case.env["WAIT_RECOVERY_SOURCE"] = str(python_source)
            with signed_api(case) as direct:
                gateway.ports[2] = int(direct.base_url.port)
                assert gateway.switch("python", "readonly").returncode == 0
                with httpx.Client(base_url=gateway.address, timeout=30, trust_env=False) as client:
                    # A legacy cookie cannot authenticate the Python slot.
                    client.cookies.set("SESSION", "old-synthetic-cookie")
                    assert client.get("/api/user/get/login").json()["code"] == 40100
                    verify_waits(client, case, waits)
                    login(client, "alice")
                    retained = client.get("/api/news/get/7007").json()["data"]
                    assert retained["title"] == "保留的切换演练新闻"
                    old = client.get("/api/diagnosis/legacy-tasks/workflow/java-wait07").json()["data"]
                    assert old["status"] == "WAITING_HUMAN_REVIEW"
                    assert client.post("/api/diagnosis/workflows").status_code == 503
                    assert act(client, waits["save"]["wait"]).status_code == 503
                # Inject API failure before reopening business writes.
                direct_port = gateway.ports[2]
            with httpx.Client(base_url=gateway.address, timeout=10, trust_env=False) as client:
                assert client.get("/api/user/get/login").status_code == 502
            assert gateway.switch("legacy", "readonly").returncode == 0
            with httpx.Client(base_url=gateway.address, timeout=30, trust_env=False) as client:
                login(client, "alice")
                assert client.get("/api/news/get/7007").json()["data"]["title"] == retained["title"]
            assert snapshot(url) == before
            report["prewriteMaintenanceWindowSeconds"] = round(time.monotonic() - maintenance_start, 3)
            report["checks"].append("pure-python-readonly-login-data-four-waits-legacy-view-failure-real-legacy-rollback")
        # Old Java has exited before business writes are reopened.
        reopen_start = time.monotonic()
        with signed_api(case) as direct:
            gateway.ports[2] = int(direct.base_url.port)
            assert gateway.ports[2] != direct_port
            assert gateway.switch("python", "readonly").returncode == 0
            with httpx.Client(base_url=gateway.address, timeout=30, trust_env=False) as client:
                verify_waits(client, case, waits)
                assert gateway.switch("python", "active").returncode == 0
                report["secondMaintenanceWindowSeconds"] = round(time.monotonic() - reopen_start, 3)
                report["firstWritePauseSeconds"] = round(time.monotonic() - maintenance_start, 3)
                login(client, "alice")
                saved = act(client, waits["save"]["wait"])
                assert saved.status_code == 200, saved.text
                assert act(client, waits["save"]["wait"]).json() == saved.json()
                assert len(case.effects(waits["save"]["workflow"])["receipts"]) == 1
                # New data after reopening provides an independent preservation sentinel.
                added = create_upload(client, key="after-reopen", content=b"invalid-image").json()["data"]["workflowId"]
                new_state = view(client, added)
                for kind in ("quality", "final"):
                    login(client, "doctor")
                    wait = waits[kind]["wait"]
                    endpoint = waits[kind]["path"]
                    version = versions if kind == "quality" else final_versions
                    assert client.post(endpoint + "/claim", json=version(wait)).status_code == 200
                    claimed = client.get(endpoint).json()["data"]
                    assert client.post(endpoint + "/submit", json={**version(claimed),
                        "decisionCode": "APPROVE_CONTINUE" if kind == "quality" else "CONFIRM_AI_ASSESSMENT",
                        "reasonCode": "QUALITY_APPROVED" if kind == "quality" else "AI_ASSESSMENT_CONFIRMED"}).status_code == 200
                login(client, "alice")
                answered_reply = reply(client, waits["supplement"]["wait"]).json()
                assert answered_reply["code"] == 0
                assert reply(client, waits["supplement"]["wait"]).json() == answered_reply
                # A post-write failure: stop the API. Never restore the old dump.
        post_failure = time.monotonic()
        assert gateway.switch("python", "readonly").returncode == 0
        after_writes = snapshot(url)
        report["afterReopen"] = after_writes
        assert after_writes != before
        rejected = gateway.switch("legacy", "readonly")
        assert rejected.returncode != 0 and b"forward repair" in rejected.stderr
        assert snapshot(url) == after_writes
        with httpx.Client(base_url=gateway.address, timeout=10, trust_env=False) as client:
            assert client.post("/api/news/add", json={}).status_code == 503
            assert client.get("/api/user/get/login").status_code == 502
        # First Python release: forward repair by restarting the fixed immutable
        # Python package, retaining the upgraded DB and all post-write audit rows.
        with signed_api(case) as direct:
            gateway.ports[2] = int(direct.base_url.port)
            assert gateway.switch("python", "readonly").returncode == 0
            with httpx.Client(base_url=gateway.address, timeout=30, trust_env=False) as client:
                login(client, "alice")
                assert view(client, added) == new_state
                assert client.get(waits["supplement"]["path"]).json()["data"] == answered_reply["data"]
                history = client.get("/api/agent/history/cutover07-supplement").json()["data"]
                assert history["supplements"] == [answered_reply["data"]]
                supplement_effects = case.effects(waits["supplement"]["workflow"])
                assert act(client, waits["save"]["wait"]).status_code == 503
                assert snapshot(url) == after_writes
                assert gateway.switch("python", "active").returncode == 0
                assert act(client, waits["save"]["wait"]).json() == saved.json()
                assert reply(client, waits["supplement"]["wait"]).json() == answered_reply
                assert case.effects(waits["supplement"]["workflow"]) == supplement_effects
                case.worker()
                for kind in ("quality", "final"):
                    assert view(client, waits[kind]["workflow"])["status"] == "COMPLETED"
                    assert not case.effects(waits[kind]["workflow"])["receipts"]
                assert len(case.effects(waits["save"]["workflow"])["receipts"]) == 1
                for item in waits.values():
                    assert case.effects(item["workflow"])["inference"] == item["effects"]["inference"]
                assert view(client, waits["supplement"]["workflow"]) == waits["supplement"]["state"]
        with child(chroma_command, directory, "chroma-recovered", health=heartbeat):
            recovered = chromadb.HttpClient(host="127.0.0.1", port=chroma_port).get_collection("diagnosis-knowledge").get(
                include=["documents", "metadatas", "embeddings"])
            assert recovered["ids"] == vector_before["ids"]
            assert recovered["documents"] == vector_before["documents"]
            assert recovered["metadatas"] == vector_before["metadatas"]
            np.testing.assert_array_equal(recovered["embeddings"], vector_before["embeddings"])
        assert sha(objects / "input.png") == sha(backup / "objects/input.png")
        report["checks"].extend(["postwrite-failure-stop-writes-reject-legacy-preserve-new-record-and-audit",
                                 "python-forward-repair-four-waits-resumed-once-no-implicit-doctor-save",
                                 "mysql-restore-to-new-schema-chroma-restart-object-backup-preserved"])
        report["postwriteRepairSeconds"] = round(time.monotonic() - post_failure, 3)
        report.update(status="PASS_WITH_LIMITATIONS", elapsedSeconds=round(time.monotonic() - started, 3),
                      waitKinds=list(waits), newWorkflowId=added, gatewayLedger=json.loads(
                          (gateway.directory / "maintenance.json").read_text()))
    finally:
        if gateway:
            gateway.close()
        (output / "rehearsal.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

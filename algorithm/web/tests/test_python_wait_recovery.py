"""Ticket 05: frozen release -> MySQL upgrade -> real-login process recovery.

Opt in with HANDOFF_TEST_MYSQL_ADMIN_URL and WAIT_RECOVERY_REDIS_SERVER.
Only new local schemas and an owned Redis child are written. Model/evidence IO
is synthetic. Samples and schemas are retained; no business database is used.
"""

import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from uuid import uuid4
import zipfile

import httpx
import pytest
from redis import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import select

from web.migrations.baseline import ASSETS, recovery_differences
from web.migrations.runner import connect, data_snapshot, query
from web.tests.handoff_fixtures import isolated_database, legacy_database
from web.tests.human_wait_process import WAIT_IDENTITIES
from web.tests.session_fixtures import seed_users
from web.tests.test_chat_workflow import send
from web.tests.test_database_handoff import cli, isolated_env
from web.tests.test_final_clinical_review import final_versions
from web.tests.test_human_wait_restart import restart_case, start, stop_child, view
from web.tests.test_quality_review import versions
from web.tests.test_save_confirmation import act, path, requested
from web.tests.test_supplement import reply, request_supplement, supplement_event
from web.tests.wait_recovery_browser import verify_refresh
from web.workflow.confirmation_models import SaveConfirmation
from web.workflow.models import Job, Workflow
from web.workflow.worker import database_now

ROOT = Path(__file__).resolve().parents[3]
BASELINE = "cf31e88f28fb00ae3cfd8cc6a1534076363b7de3"


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


@pytest.fixture(scope="module")
def recovery_runtime(tmp_path_factory):
    binary = os.getenv("WAIT_RECOVERY_REDIS_SERVER")
    if not os.getenv("HANDOFF_TEST_MYSQL_ADMIN_URL") or not binary:
        pytest.skip("Opt-in ticket05 isolated real MySQL/Redis acceptance")
    directory = tmp_path_factory.mktemp("python-wait-release")
    archive = directory / "baseline.zip"
    subprocess.run(["git", "archive", "--format=zip", "--output", str(archive), BASELINE,
                    "algorithm", "deploy", "src", "pom.xml"], cwd=ROOT, check=True, timeout=60)
    source = directory / "baseline"
    with zipfile.ZipFile(archive) as frozen:
        frozen.extractall(source)
    port = free_port()
    with (directory / "redis.log").open("wb") as log:
        child = subprocess.Popen([binary, "--bind", "127.0.0.1", "--port", str(port),
            "--save", "", "--appendonly", "no", "--dir", str(directory)], stdout=log, stderr=log,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        redis = Redis(host="127.0.0.1", port=port, protocol=2)
        try:
            deadline = time.monotonic() + 15
            while True:
                assert child.poll() is None, "Owned Redis child exited"
                try:
                    if redis.ping():
                        break
                except RedisConnectionError:
                    pass
                assert time.monotonic() < deadline, "Redis startup timed out"
                time.sleep(.05)
            yield source, f"redis://127.0.0.1:{port}/0", directory
        finally:
            redis.close()
            stop_child(child)


@pytest.fixture
def recovery_case(recovery_runtime, monkeypatch, request):
    source, redis_url, _ = recovery_runtime
    url, schema = isolated_database(os.environ["HANDOFF_TEST_MYSQL_ADMIN_URL"],
                                   prefix="eye_human_wait_issue17_")
    legacy_database(url, 22)
    monkeypatch.setenv("HUMAN_WAIT_TEST_MYSQL_URL", url)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    case = request.getfixturevalue("restart_case")
    seed_users(case.sessions.kw["bind"], {**WAIT_IDENTITIES,
        "bob": replace(WAIT_IDENTITIES["bob"], account="bob-user")})
    case.env.update(HUMAN_WAIT_PROCESS_SCRIPT=str(Path(__file__).with_name("wait_recovery_process.py")),
                    WAIT_RECOVERY_SOURCE=str(source), WAIT_RECOVERY_REDIS_URL=redis_url,
                    WAIT_RECOVERY_SESSION_PREFIX=f"eye:issue05:{schema}:",
                    WAIT_RECOVERY_FRONTEND=f"http://127.0.0.1:{free_port()}")
    case.env = isolated_env(**{key: value for key, value in case.env.items()
                              if key.startswith(("HUMAN_WAIT_", "WAIT_RECOVERY_"))},
                            NO_PROXY="127.0.0.1,localhost")
    case.evidence.update(baselineCommit=BASELINE, schema=schema, identity="real Cookie/Redis/t_user")
    yield case, url


@contextmanager
def signed_api(case, who="alice"):
    with case.api() as client:
        client.cookies.clear()
        login(client, who)
        yield client


def login(client, who):
    account = "bob-user" if who == "bob" else who
    response = client.post("/api/user/login", json={"userAccount": account, "userPassword": "fixture-password"})
    assert response.json()["code"] == 0, response.text
    assert client.get("/api/user/get/login").json()["data"]["id"] == str(WAIT_IDENTITIES[who].user_id)


def sample(case, url, kind, workflow_id, wait):
    """Keep actual synthetic input/checkpoint/pending bytes, not just counts."""
    def encode(value):
        if isinstance(value, bytes):
            return {"base64": base64.b64encode(value).decode(), "sha256": hashlib.sha256(value).hexdigest()}
        return str(value)

    with connect(url) as db:
        tables = ["t_diagnosis_workflow", "t_workflow_upload_input", "t_python_graph_checkpoint",
                  "t_python_graph_write", "t_human_review_task", "t_inference_envelope",
                  "t_diagnosis_save_confirmation", "t_python_chat_supplement",
                  "t_workflow_job", "t_diagnosis_workflow_event", "t_explanation_snapshot"]
        # Table names are fixed by this test, never supplied by a caller.
        rows = {name: query(db, f"SELECT * FROM `{name}`") for name in tables}
    payload = {"kind": kind, "baselineCommit": BASELINE, "workflowId": workflow_id, "wait": wait,
               "graph": json.loads((ASSETS / "recovery-samples.json").read_text()), "rows": rows}
    file = case.directory / f"before-{kind}.json"
    file.write_text(json.dumps(payload, default=encode, ensure_ascii=False, indent=2), encoding="utf-8")
    output = os.getenv("HUMAN_WAIT_EVIDENCE_DIR")
    if output:
        import shutil
        destination = Path(output) / f"{case.directory.name}-before-{kind}.json"
        shutil.copyfile(file, destination)
        case.evidence["sample"] = {"file": destination.name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}


def upgrade(case, url):
    with connect(url) as db:
        before = data_snapshot(db)
    result = cli("upgrade", env=isolated_env(MIGRATION_MYSQL_URL=url))
    assert result.returncode == 0, result.stdout
    with connect(url) as db:
        assert data_snapshot(db, before) == before
    assert recovery_differences(ASSETS) == []
    case.env["WAIT_RECOVERY_SOURCE"] = str(ROOT)
    case.evidence["upgrade"] = json.loads(result.stdout)


def state_event(client, workflow_id):
    response = client.get(f"/api/diagnosis/workflows/{workflow_id}/events")
    assert response.status_code == 200 and "event: done" in response.text
    frame = next(part for part in response.text.split("\n\n") if part.startswith("event: state\n"))
    return json.loads(frame.split("data: ", 1)[1])


@pytest.mark.parametrize("kind", ["quality", "final", "save", "supplement"])
def test_frozen_wait_upgrade_real_login_and_process_restart(recovery_case, kind):
    case, url = recovery_case
    thread = "recovery-" + uuid4().hex
    with signed_api(case) as client:
        workflow_id = start(client)
        case.worker(kind if kind in {"quality", "final"} else "pass")
        original = view(client, workflow_id)
        assert "event: done" in send(client, thread=thread, workflowId=workflow_id).text
        if kind == "save":
            wait = client.post(path(workflow_id), json=requested(original)).json()["data"]
        elif kind == "supplement":
            wait = supplement_event(request_supplement(client, workflow_id, thread=thread))
        else:
            login(client, "doctor")
            task = next(row for row in client.get("/api/reviews/tasks").json()["data"] if row["workflowId"] == workflow_id)
            wait_url = f"/api/reviews/tasks/{task['reviewTaskId']}"
            wait = client.get(wait_url).json()["data"]
        sample(case, url, kind, workflow_id, wait)
        effects = case.effects(workflow_id)
    upgrade(case, url)
    with signed_api(case, "doctor" if kind in {"quality", "final"} else "alice") as client:
        case.worker()  # An idle restarted Worker must not consume human waits.
        assert case.effects(workflow_id) == effects
        # Reconnecting SSE transports resolve the owner from a fresh real login.
        with httpx.Client(base_url=str(client.base_url), timeout=20) as owner:
            login(owner, "alice")
            pending = state_event(owner, workflow_id)
            assert pending["workflow"] == original
            assert state_event(owner, workflow_id) == pending
            if kind == "save":
                assert pending["saveConfirmation"] == wait
            elif kind == "supplement":
                assert pending["supplements"] == [wait]
            assert [row["workflowId"] for row in owner.get(f"/api/agent/history/{thread}")
                    .json()["data"]["workflows"]] == [workflow_id]
        verify_refresh(case, client, kind, workflow_id, wait, thread)
        if kind in {"quality", "final"}:
            assert client.get(wait_url).json()["data"] == wait
            version = versions if kind == "quality" else final_versions
            assert client.post(wait_url + "/claim", json=version(wait)).status_code == 200
            claimed = client.get(wait_url).json()["data"]
            payload = {**version(claimed), "decisionCode": "APPROVE_CONTINUE" if kind == "quality" else "CONFIRM_AI_ASSESSMENT",
                       "reasonCode": "QUALITY_APPROVED" if kind == "quality" else "AI_ASSESSMENT_CONFIRMED"}
            submitted = client.post(wait_url + "/submit", json=payload)
            assert submitted.status_code == 200, submitted.text
        elif kind == "save":
            assert client.get(path(workflow_id)).json()["data"] == wait
            assert act(client, wait, expectedWorkflowVersion="0").status_code == 409
        else:
            assert client.get(f"/api/agent/history/{thread}").json()["data"]["supplements"] == [wait]
            assert reply(client, wait, version="9").json()["code"] == 50001
    # Restart again after the doctor decision, before the Worker continuation.
    with signed_api(case) as client:
        if kind in {"quality", "final"}:
            case.worker()
            assert view(client, workflow_id)["status"] == "COMPLETED"
            assert not case.effects(workflow_id)["receipts"]
        elif kind == "save":
            with ThreadPoolExecutor(max_workers=6) as pool:
                responses = list(pool.map(lambda _: act(client, wait), range(6)))
            approved = responses[0]
            assert [response.status_code for response in responses] == [200] * 6
            assert all(response.json() == approved.json() for response in responses)
            case.evidence["concurrentApprovals"] = 6
            assert act(client, wait).json() == approved.json()
        else:
            answered = reply(client, wait)
            assert answered.json()["code"] == 0, answered.text
            assert reply(client, wait).json() == answered.json()
            assert view(client, workflow_id) == original
        state = state_event(client, workflow_id)
        assert state["workflow"] == view(client, workflow_id)
        history = client.get(f"/api/agent/history/{thread}").json()["data"]
        assert [row["workflowId"] for row in history["workflows"]] == [workflow_id]
        stable = case.effects(workflow_id)
        assert stable["inference"] == effects["inference"]
        assert len(stable["receipts"]) == (1 if kind == "save" else 0)
        case.worker()
        assert case.effects(workflow_id) == stable
    with signed_api(case) as client:
        if kind == "save":
            assert act(client, wait).json() == approved.json()
        assert state_event(client, workflow_id) == state
        assert case.effects(workflow_id) == stable
        login(client, "bob")
        assert client.get(f"/api/diagnosis/workflows/{workflow_id}").status_code == 403
        assert client.get(f"/api/diagnosis/workflows/{workflow_id}/events").status_code == 403
    assert case.calls() == ["inference", "explanation"]
    case.evidence["kind"] = kind
    case.evidence["result"] = "PASS"


def test_expired_save_survives_upgrade_without_formal_record(recovery_case):
    case, url = recovery_case
    with signed_api(case) as client:
        workflow_id = start(client)
        case.worker("pass")
        wait = client.post(path(workflow_id), json=requested(view(client, workflow_id))).json()["data"]
    with case.sessions.begin() as db:
        db.get(SaveConfirmation, wait["confirmationId"]).expires_at -= timedelta(hours=1)
    upgrade(case, url)
    with signed_api(case) as client:
        assert act(client, wait).status_code == 409
        assert client.get(path(workflow_id)).json()["data"]["status"] == "EXPIRED"
        assert not case.effects(workflow_id)["receipts"]


@pytest.mark.parametrize("token", ["graph_version", "graph_hash", "action_version", "supplement"])
def test_incompatible_wait_is_preserved_across_upgrade(recovery_case, token):
    case, url = recovery_case
    with signed_api(case) as client:
        workflow_id = start(client)
        case.worker("quality")
        if token == "supplement":
            assert "event: done" in send(client, thread="fault", workflowId=workflow_id).text
            wait = supplement_event(request_supplement(client, workflow_id, thread="fault"))
    upgrade(case, url)
    with case.sessions.begin() as db:
        if token == "supplement":
            from web.chat.supplement import Supplement
            db.get(Supplement, wait["requestId"]).graph_version = "incompatible"
        else:
            setattr(db.get(Workflow, workflow_id), token, "incompatible")
    before = case.effects(workflow_id)
    with connect(url) as db:
        durable = data_snapshot(db)
    with signed_api(case, "alice" if token == "supplement" else "doctor") as client:
        if token == "supplement":
            response = reply(client, wait).json()
            assert response["code"] == 50001 and "版本已变化" in response["msg"]
            assert client.get(f"/api/agent/supplements/{wait['requestId']}").json()["data"] == wait
        else:
            task_id = before["reviews"][0]["task_id"]
            endpoint = f"/api/reviews/tasks/{task_id}"
            task = client.get(endpoint).json()["data"]
            assert client.post(endpoint + "/claim", json=versions(task)).status_code == 409
        case.worker()
        assert case.effects(workflow_id) == before
    with connect(url) as db:
        assert data_snapshot(db) == durable  # Includes exact checkpoints/pending writes.
    assert case.calls() == ["inference"]


@pytest.mark.parametrize("crash", [False, True], ids=["stale-executor", "killed-executor"])
def test_mysql_resumed_wait_lease_fences_abandoned_worker(recovery_case, tmp_path, crash):
    from web.tests.test_worker_concurrency import executor

    case, url = recovery_case
    with signed_api(case) as client:
        workflow_id = start(client)
        case.worker("quality")
    upgrade(case, url)
    with signed_api(case, "doctor") as client:
        task = next(row for row in client.get("/api/reviews/tasks").json()["data"] if row["workflowId"] == workflow_id)
        endpoint = f"/api/reviews/tasks/{task['reviewTaskId']}"
        assert client.post(endpoint + "/claim", json=versions(task)).status_code == 200
        claimed = client.get(endpoint).json()["data"]
        assert client.post(endpoint + "/submit", json={**versions(claimed),
            "decisionCode": "APPROVE_CONTINUE", "reasonCode": "QUALITY_APPROVED"}).status_code == 200
    # Three durable nodes, each in a fresh production Worker process.
    for index in range(3):
        with executor(case.sessions, tmp_path, f"advance-{index}"):
            pass
    with signed_api(case) as client:
        assert view(client, workflow_id)["progress"]["current"] == "evidenceRetrieval"
        before = case.effects(workflow_id)
        with executor(case.sessions, tmp_path, "abandoned", mode="retrieval-empty", gated=True, crash=crash) as (child, _):
            # NOWAIT proves model/retrieval IO does not retain business locks.
            with case.sessions.begin() as db:
                job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RUNNING")
                                .with_for_update(nowait=True))
                db.scalar(select(Workflow).where(Workflow.workflow_id == workflow_id).with_for_update(nowait=True))
                now = database_now(db)
                assert now < job.lease_until <= now + timedelta(seconds=30)
                old_token, old_fence, job_id = job.lease_token, job.lease_version, job.job_id
            if crash:
                stop_child(child)
            with case.sessions.begin() as db:
                db.get(Job, job_id).lease_until = database_now(db) - timedelta(seconds=1)
            case.worker()
            stable = case.effects(workflow_id)
            assert stable["inference"] == before["inference"]
            assert stable["status"] == "COMPLETED" and not stable["receipts"]
            with case.sessions() as db:
                replacement = db.get(Job, job_id)
                assert replacement.lease_token != old_token and replacement.lease_version == old_fence + 1
                case.evidence["fencing"] = {"jobId": job_id, "oldLeaseVersion": old_fence,
                    "replacementLeaseVersion": replacement.lease_version, "tokenRotated": True,
                    "databaseTime": now.isoformat(), "lockNowait": "PASS", "killed": crash}
        assert case.effects(workflow_id) == stable
        assert state_event(client, workflow_id)["workflow"]["status"] == "COMPLETED"

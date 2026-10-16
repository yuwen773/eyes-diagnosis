"""Task HTTP / real Worker seams; MySQL mode uses Python-migrated test schemas.

Identity and algorithm results are controlled. SQLite is regression coverage,
never evidence for MySQL locking, leases or fencing.
"""

import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta
import os
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.app import create_app
from web.config import WebConfig
from web.db import Base
from web.deps import get_db
from web.models.knowledge import KnowledgeDocument
from web.tests.test_workflow import create_upload
from web.tests.test_workflow_inference import ControlledEngine, prediction, query
from web.workflow.inference import WorkflowInference
from web.workflow.models import (
    GraphCheckpoint, GraphWrite, InferenceEnvelopeRow, Job, ReviewTask,
    UploadInput, Workflow, WorkflowEvent,
)
from web.workflow.worker import Worker, database_now
from web.tests.session_fixtures import SESSION_COOKIE_NAME, install_sessions  # noqa: E402


@pytest.fixture
def worker_api(tmp_path):
    url = os.getenv("WORKER_TEST_MYSQL_URL")
    if url:
        target = make_url(url)
        if (target.get_backend_name() != "mysql" or
                target.host not in {"127.0.0.1", "localhost"} or
                not (target.database or "").startswith("eye_worker_issue16_")):
            raise ValueError("Use a local, isolated eye_worker_issue16_ schema migrated by Flyway")
    engine = create_engine(url or f"sqlite:///{tmp_path / 'worker.db'}",
                           connect_args={"init_command": "SET time_zone = '+08:00'"} if url else {})
    app = create_app(WebConfig())
    if not url:
        Base.metadata.create_all(engine)
    # Match production: no implicit flush of staged checkpoints/business effects.
    sessions = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    if url:
        # Only the guarded test schema is cleared; production DDL is Flyway's.
        with sessions.begin() as db:
            for model in (GraphWrite, GraphCheckpoint, ReviewTask, InferenceEnvelopeRow,
                          WorkflowEvent, Job, UploadInput, Workflow, KnowledgeDocument):
                db.query(model).delete()

    def database():
        with sessions() as db:
            yield db
            db.commit()


    app.dependency_overrides[get_db] = database
    auth = install_sessions(app, engine)
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    yield client, sessions
    client.close()
    engine.dispose()


def upload(client, content=None):
    response = create_upload(client, key=uuid4().hex, content=content)
    assert response.status_code == 202
    return response.json()["data"]["workflowId"]


def test_redelivery_cannot_reopen_a_terminal_workflow(worker_api):
    client, sessions = worker_api
    workflow_id = upload(client, b"invalid-image")
    assert Worker(sessions).run_once()
    final = query(client, workflow_id)
    assert (final["status"], final["stopReasonCode"]) == ("REJECTED", "INVALID_IMAGE")
    # Replay delivery of the same durable job after acknowledgement was lost.
    with sessions.begin() as db:
        job = db.scalar(select(Job).where(Job.workflow_id == workflow_id))
        job.status = "READY"
    Worker(sessions).run_once()
    assert query(client, workflow_id) == final
    assert not Worker(sessions).run_once()


def test_redelivery_cannot_advance_the_next_committed_segment(worker_api):
    client, sessions = worker_api
    workflow_id = upload(client)
    assert Worker(sessions).run_once()
    validated = query(client, workflow_id)
    assert validated["progress"]["completed"] == ["validateImage"]
    with sessions.begin() as db:
        start = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.job_type == "START"))
        start.status = "READY"
    Worker(sessions).run_once()
    assert query(client, workflow_id) == validated
    # The legitimate continuation can still run after discarding redelivery.
    assert Worker(sessions).run_once()
    assert query(client, workflow_id)["stopReasonCode"] == "MODEL_UNAVAILABLE"


@contextmanager
def executor(sessions, tmp_path, name, *, mode="normal", gated=False, lease=30, crash=False):
    gate = tmp_path / name
    env = os.environ.copy()
    env["WORKER_TEST_DATABASE_URL"] = sessions.kw["bind"].url.render_as_string(hide_password=False)
    args = [sys.executable, "-m", "web.tests.worker_concurrency_process", "--mode", mode,
            "--lease-seconds", str(lease)]
    if gated:
        args.extend(["--gate", str(gate)])
    process = subprocess.Popen(args, env=env, cwd=Path(__file__).resolve().parents[2],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        if gated:
            deadline = time.monotonic() + 20
            while not gate.with_suffix(".started").exists():
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise AssertionError("Worker did not reach controlled adapter")
                time.sleep(.02)
        yield process, gate
    finally:
        gate.with_suffix(".release").touch()
        try:
            output, error = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise
        assert (process.returncode != 0 if crash else process.returncode == 0), error


def effects(sessions, workflow_id):
    """Ticket explicitly requires DB effects alongside the task HTTP view."""
    with sessions() as db:
        envelope = db.scalar(select(InferenceEnvelopeRow).where(InferenceEnvelopeRow.workflow_id == workflow_id))
        return {
            "envelope": (envelope.envelope_id, envelope.prediction_snapshot) if envelope else None,
            "envelopes": db.scalar(select(func.count()).select_from(InferenceEnvelopeRow).where(
                InferenceEnvelopeRow.workflow_id == workflow_id)),
            "checkpoints": db.scalar(select(func.count()).select_from(GraphCheckpoint).where(
                GraphCheckpoint.thread_id == workflow_id)),
            "writes": db.scalar(select(func.count()).select_from(GraphWrite).where(GraphWrite.thread_id == workflow_id)),
            "events": db.scalar(select(func.count()).select_from(WorkflowEvent).where(WorkflowEvent.workflow_id == workflow_id)),
            "reviews": db.scalar(select(func.count()).select_from(ReviewTask).where(ReviewTask.workflow_id == workflow_id)),
        }


def prepare_inference(worker_api):
    client, sessions = worker_api
    workflow_id = upload(client)
    assert Worker(sessions).run_once()
    return workflow_id


def test_two_executors_compete_without_holding_model_transaction(worker_api, tmp_path):
    client, sessions = worker_api
    workflow_id = prepare_inference(worker_api)
    with sessions() as db:
        before = database_now(db)
    with executor(sessions, tmp_path, "slow", gated=True):
        running = query(client, workflow_id)
        assert running["status"] == "RUNNING"
        with sessions.begin() as db:
            now = database_now(db)
            # A model call must leave both rows available for another DB session.
            # MySQL NOWAIT makes an accidental long transaction fail immediately.
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RUNNING")
                            .with_for_update(nowait=True))
            db.scalar(select(Workflow).where(Workflow.workflow_id == workflow_id).with_for_update(nowait=True))
            assert before + timedelta(seconds=30) <= job.lease_until <= now + timedelta(seconds=30)
        with executor(sessions, tmp_path, "competitor") as (process, _):
            process.wait(timeout=20)
        assert query(client, workflow_id) == running
    assert query(client, workflow_id)["progress"]["completed"] == ["validateImage", "inference"]
    assert effects(sessions, workflow_id)["envelope"] is not None
    assert effects(sessions, workflow_id)["envelopes"] == 1


@pytest.mark.parametrize("stale_mode", ["glaucoma", "timeout"])
def test_expired_executor_cannot_overwrite_replacement_or_retry_it(worker_api, tmp_path, stale_mode):
    client, sessions = worker_api
    workflow_id = prepare_inference(worker_api)
    with executor(sessions, tmp_path, "expired", gated=True, mode=stale_mode):
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RUNNING"))
            old_token, old_version = job.lease_token, job.lease_version
            job.lease_until = database_now(db) - timedelta(seconds=1)
        with executor(sessions, tmp_path, "replacement") as (process, _):
            process.wait(timeout=20)
        replacement = query(client, workflow_id)
        committed = effects(sessions, workflow_id)
        assert replacement["progress"]["completed"] == ["validateImage", "inference"]
        assert '"normal"' in committed["envelope"][1]
        with sessions() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.epoch == 1))
            assert job.lease_token != old_token and job.lease_version == old_version + 1
    assert query(client, workflow_id) == replacement
    assert effects(sessions, workflow_id) == committed


@pytest.mark.parametrize("fault", ["lease", "token", "lease_version", "workflow_version"])
def test_stale_execution_discards_all_staged_effects(worker_api, tmp_path, fault):
    client, sessions = worker_api
    workflow_id = prepare_inference(worker_api)
    before = effects(sessions, workflow_id)
    with executor(sessions, tmp_path, "stale", gated=True):
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RUNNING"))
            if fault == "lease":
                job.lease_until = database_now(db) - timedelta(seconds=1)
            elif fault == "token":
                job.lease_token = uuid4().hex
            elif fault == "lease_version":
                job.lease_version += 1
            else:
                db.get(Workflow, workflow_id).version += 1
        fenced = query(client, workflow_id)
        fenced_effects = effects(sessions, workflow_id)
    assert query(client, workflow_id) == fenced
    assert effects(sessions, workflow_id) == fenced_effects
    assert fenced_effects["envelope"] is None
    assert fenced_effects["checkpoints"] == before["checkpoints"]
    # A fresh process recovers from the last committed checkpoint, not stale RAM.
    with sessions.begin() as db:
        db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RUNNING")).lease_until = datetime(2000, 1, 1)
    with executor(sessions, tmp_path, "recovered") as (process, _):
        process.wait(timeout=20)
    assert query(client, workflow_id)["progress"]["completed"] == ["validateImage", "inference"]


def test_model_timeout_exhausts_retries_as_failed_not_review(worker_api, tmp_path):
    client, sessions = worker_api
    workflow_id = prepare_inference(worker_api)
    for expected in ["QUEUED", "QUEUED", "FAILED"]:
        with executor(sessions, tmp_path, uuid4().hex, mode="timeout") as (process, _):
            process.wait(timeout=20)
        view = query(client, workflow_id)
        assert view["status"] == expected
        assert view["result"] is None and view["qualityGate"] is None
        assert not view["resultAvailability"]["doctorReviewRequired"]
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.epoch == 1))
            if expected != "FAILED":
                assert job.status == "RETRY_WAIT"
                assert job.available_at > database_now(db)
                job.available_at = datetime(2000, 1, 1)
    assert view["stopReasonCode"] == "INFERENCE_FAILED"
    assert effects(sessions, workflow_id)["envelope"] is None
    assert effects(sessions, workflow_id)["reviews"] == 0
    assert not Worker(sessions).run_once()


def prepare_retrieval(worker_api):
    client, sessions = worker_api
    workflow_id = upload(client)
    adapter = WorkflowInference(WebConfig(), engine=ControlledEngine(prediction()))
    for _ in range(5):
        assert Worker(sessions, inference=adapter).run_once()
    assert query(client, workflow_id)["progress"]["current"] == "evidenceRetrieval"
    with sessions.begin() as db:
        now = database_now(db)
        db.add(KnowledgeDocument(id=16, user_id=7, title="Controlled reference", file_name="reference.txt",
            file_url="https://fixture.invalid/reference.txt", file_type="txt", status=1,
            visibility="CURATED_PUBLIC", review_status="APPROVED", disease_codes=["glaucoma"],
            topic_codes=["DISEASE_OVERVIEW"], create_time=now, update_time=now))
    return workflow_id


def test_retrieval_outage_retries_instead_of_becoming_clinical_insufficiency(worker_api, tmp_path):
    client, sessions = worker_api
    workflow_id = prepare_retrieval(worker_api)
    for expected in ("QUEUED", "QUEUED", "FAILED"):
        with executor(sessions, tmp_path, uuid4().hex, mode="retrieval-timeout") as (process, _):
            process.wait(timeout=20)
        view = query(client, workflow_id)
        assert view["status"] == expected
        assert view["progress"]["completed"][-1] == "clinicalRiskPrecheck"
        assert view["result"] is None
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RETRY_WAIT"))
            if job:
                job.available_at = datetime(2000, 1, 1)
    assert view["stopReasonCode"] == "EXECUTION_FAILED"
    assert effects(sessions, workflow_id)["reviews"] == 0


def test_slow_tool_holds_no_transaction_and_discards_expired_result(worker_api, tmp_path):
    client, sessions = worker_api
    workflow_id = prepare_retrieval(worker_api)
    with executor(sessions, tmp_path, "slow-tool", mode="retrieval-empty", gated=True):
        running = query(client, workflow_id)
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RUNNING")
                            .with_for_update(nowait=True))
            db.scalar(select(Workflow).where(Workflow.workflow_id == workflow_id).with_for_update(nowait=True))
            job.lease_until = database_now(db) - timedelta(seconds=1)
        before = effects(sessions, workflow_id)
    assert query(client, workflow_id) == running
    assert effects(sessions, workflow_id) == before
    with executor(sessions, tmp_path, "recovered-tool", mode="retrieval-empty") as (process, _):
        process.wait(timeout=20)
    assert query(client, workflow_id)["progress"]["completed"][-1] == "evidenceRetrieval"


def test_worker_process_crashes_exhaust_budget_without_replaying_completed_nodes(worker_api, tmp_path):
    client, sessions = worker_api
    workflow_id = prepare_inference(worker_api)
    for attempt in range(1, 4):
        with executor(sessions, tmp_path, f"crash-{attempt}", gated=True, crash=True) as (process, _):
            process.kill()  # Only the child started by this test, inside its model call.
            process.wait(timeout=10)
        assert query(client, workflow_id)["progress"]["completed"] == ["validateImage"]
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RUNNING"))
            assert job.attempt == attempt
            job.lease_until = database_now(db) - timedelta(seconds=1)
    with executor(sessions, tmp_path, "exhausted") as (process, _):
        process.wait(timeout=20)
    final = query(client, workflow_id)
    assert (final["status"], final["stopReasonCode"]) == ("FAILED", "RETRY_EXHAUSTED")
    assert final["progress"]["completed"] == ["validateImage"]
    assert effects(sessions, workflow_id)["envelopes"] == 0
    assert effects(sessions, workflow_id)["reviews"] == 0


def test_mysql_claim_skips_locked_job_and_advances_other_task(worker_api, tmp_path):
    client, sessions = worker_api
    if sessions.kw["bind"].dialect.name != "mysql":
        pytest.skip("SKIP LOCKED requires real MySQL")
    locked_id = upload(client)
    other_id = upload(client)
    with sessions.begin() as db:
        job_id = db.scalar(select(Job.job_id).where(Job.workflow_id == locked_id))
        # Lock exactly one primary record. A workflow-prefix lookup also takes
        # next-key gap locks, blocking the other task's continuation INSERT.
        db.scalar(select(Job).where(Job.job_id == job_id).with_for_update())
        with executor(sessions, tmp_path, "skip-locked") as (process, _):
            process.wait(timeout=20)
        assert query(client, other_id)["progress"]["completed"] == ["validateImage"]
        assert query(client, locked_id)["status"] == "QUEUED"
    assert Worker(sessions).run_once()
    assert query(client, locked_id)["progress"]["completed"] == ["validateImage"]

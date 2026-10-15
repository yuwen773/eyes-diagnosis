"""Durable-upload HTTP seam. SQLite/Java transport doubles, no model results."""

import asyncio
import io
import sys
import subprocess
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.app import create_app
from web.config import WebConfig
from web.db import Base
from web.deps import get_db
from web.tests.session_fixtures import SESSION_COOKIE_NAME, install_sessions  # noqa: E402


def picture_bytes():
    output = io.BytesIO()
    Image.new("RGB", (32, 32), "red").save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def workflow_api(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'workflow.db'}")
    app = create_app(WebConfig())
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def database():
        with sessions() as session:
            yield session
            session.commit()


    app.dependency_overrides[get_db] = database
    auth = install_sessions(app, engine)
    client = TestClient(app, raise_server_exceptions=True)
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    yield client, sessions
    client.close()
    engine.dispose()


def create_upload(client, key="upload-1", content=None, question=""):
    return client.post("/api/diagnosis/workflows", data={"idempotencyKey": key, "question": question},
                       files={"file": ("fundus.png", content or picture_bytes(), "image/png")})


def test_upload_is_accepted_once_and_only_readable_by_its_owner(workflow_api):
    client, _ = workflow_api
    response = create_upload(client)
    assert response.status_code == 202
    created = response.json()["data"]
    workflow_id = created["workflowId"]
    assert created["status"] == "QUEUED"
    assert create_upload(client).json()["data"]["workflowId"] == workflow_id
    status = client.get(f"/api/diagnosis/workflows/{workflow_id}")
    assert status.status_code == 200
    assert status.json()["data"]["result"] is None
    client.cookies.set(SESSION_COOKIE_NAME, "bob")
    assert client.get(f"/api/diagnosis/workflows/{workflow_id}").status_code == 403
    assert create_upload(client).json()["data"]["workflowId"] != workflow_id


def test_registered_worker_validates_input_then_reports_unavailable_without_diagnosis(workflow_api):
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    worker = Worker(sessions)
    assert worker.run_once()
    status = client.get(f"/api/diagnosis/workflows/{workflow_id}").json()["data"]
    assert status["status"] == "RUNNING"
    assert status["progress"]["completed"] == ["validateImage"]
    # A new worker and graph instance must resume the persisted token.
    assert Worker(sessions).run_once()
    status = client.get(f"/api/diagnosis/workflows/{workflow_id}").json()["data"]
    assert status["status"] == "FAILED"
    assert status["stopReasonCode"] == "MODEL_UNAVAILABLE"
    assert status["progress"]["completed"] == ["validateImage", "inference"]
    assert status["result"] is None
    assert status["resultAvailability"]["patientVisible"] is False
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
    assert not Worker(sessions).run_once()


def test_reusing_an_idempotency_key_for_different_content_is_a_conflict(workflow_api):
    client, _ = workflow_api
    assert create_upload(client).status_code == 202
    assert create_upload(client, content=b"different-input").status_code == 409


def test_invalid_image_reaches_rejected_without_diagnostic_output(workflow_api):
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    workflow_id = create_upload(client, content=b"not-an-image").json()["data"]["workflowId"]
    assert Worker(sessions).run_once()
    status = client.get(f"/api/diagnosis/workflows/{workflow_id}").json()["data"]
    assert (status["status"], status["stopReasonCode"]) == ("REJECTED", "INVALID_IMAGE")
    assert status["result"] is None
    assert not Worker(sessions).run_once()


def test_task_resumes_in_another_os_process_without_revalidating_input(workflow_api):
    client, sessions = workflow_api
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    database_url = str(sessions.kw["bind"].url)
    script = """
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from web.workflow.worker import Worker
engine = create_engine(sys.argv[1])
assert Worker(sessionmaker(engine, expire_on_commit=False)).run_once()
engine.dispose()
"""
    for expected in ("RUNNING", "FAILED"):
        result = subprocess.run([sys.executable, "-c", script, database_url],
                                capture_output=True, text=True, timeout=30,
                                cwd=Path(__file__).resolve().parents[2])
        assert result.returncode == 0, result.stderr
        status = client.get(f"/api/diagnosis/workflows/{workflow_id}").json()["data"]
        assert status["status"] == expected
    assert status["progress"]["completed"] == ["validateImage", "inference"]


def test_new_api_rejects_anonymous_and_malformed_requests_with_real_http_status(workflow_api):
    client, _ = workflow_api
    assert client.post("/api/diagnosis/workflows", files={
        "file": ("fundus.png", picture_bytes(), "image/png")
    }).status_code == 422
    assert create_upload(client, content=b"x" * (2 * 1024 * 1024 + 1)).status_code == 413
    client.cookies.clear()
    assert create_upload(client).status_code == 401


def test_incompatible_graph_version_fails_instead_of_replaying_another_graph(workflow_api):
    from web.workflow.models import Workflow
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    # Simulate a persisted task from an incompatible deployment at the DB boundary.
    with sessions.begin() as db:
        db.get(Workflow, workflow_id).graph_version = "incompatible-deployment"
    assert Worker(sessions).run_once()
    status = client.get(f"/api/diagnosis/workflows/{workflow_id}").json()["data"]
    assert (status["status"], status["stopReasonCode"]) == ("FAILED", "GRAPH_VERSION_INCOMPATIBLE")
    assert status["progress"]["completed"] == []
    assert status["result"] is None


def test_python_worker_leaves_legacy_runtime_jobs_to_their_own_executor(workflow_api):
    from web.workflow.models import Job, Workflow
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    # Persisted release task, with no Python upload input. Earlier in the queue.
    with sessions.begin() as db:
        db.add(Workflow(workflow_id="legacy", owner_user_id=7, idempotency_key="legacy",
                        status="QUEUED", graph_version="java-release", graph_hash="legacy",
                        action_version="legacy"))
        db.add(Job(job_id="legacy-job", workflow_id="legacy", job_type="RESUME",
                   segment_code="legacy-segment", available_at=datetime(2000, 1, 1)))
    assert Worker(sessions).run_once()
    status = client.get(f"/api/diagnosis/workflows/{workflow_id}").json()["data"]
    assert status["progress"]["completed"] == ["validateImage"]

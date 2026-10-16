"""HTTP over TCP + terminated/restarted API/Worker processes; opt-in real MySQL.

SQLite is regression only. Identity, algorithm, retrieval and explanation are
controlled external adapters; business state/checkpoints use production storage.
"""

from contextlib import contextmanager
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.app import create_app
from web.config import WebConfig
from web.db import Base
from web.models.knowledge import KnowledgeDocument
from web.models.diagnosis import Diagnosis
from web.tests.test_workflow import create_upload
from web.tests.test_quality_review import versions
from web.tests.test_final_clinical_review import final_versions
from web.tests.test_save_confirmation import path, requested, act
from web.tests.test_supplement import request_supplement, supplement_event, reply
from web.tests.test_chat_workflow import send
from web.workflow.models import (
    ExplanationSnapshot, GraphCheckpoint, GraphWrite, InferenceEnvelopeRow, Job, ReviewTask, UploadInput, Workflow, WorkflowEvent,
)
from web.workflow.confirmation_models import SaveConfirmation, SavedWorkflowDiagnosis
from web.tests.session_fixtures import SESSION_COOKIE_NAME  # noqa: E402
from web.chat.supplement import Supplement
from web.chat.models import ChatAudit, ChatMessage, ChatRun, ChatSession, ChatWorkflow
from web.workflow.checkpoint import MysqlCheckpointSaver


@pytest.fixture
def restart_case(tmp_path):
    url = os.getenv("HUMAN_WAIT_TEST_MYSQL_URL")
    if url:
        target = make_url(url)
        if (target.get_backend_name() != "mysql" or target.host not in {"localhost", "127.0.0.1"}
                or not (target.database or "").startswith("eye_human_wait_issue17_")):
            raise ValueError("Use an isolated local eye_human_wait_issue17_ schema migrated by Flyway")
    # Import routes to register every ORM model before SQLite-only DDL.
    create_app(WebConfig())
    engine = create_engine(url or f"sqlite:///{tmp_path / 'wait.db'}",
                           connect_args={"init_command": "SET time_zone = '+08:00'"} if url else {})
    if not url:
        Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    if url:
        # Every case owns the guarded test schema; unfinished jobs from a fault
        # case must not be picked up by the next case's Worker.
        with sessions.begin() as db:
            for model in (Supplement, ChatWorkflow, ChatAudit, ChatRun, ChatMessage, ChatSession,
                          SavedWorkflowDiagnosis, SaveConfirmation, Diagnosis, GraphWrite, GraphCheckpoint,
                          ReviewTask, ExplanationSnapshot, InferenceEnvelopeRow, WorkflowEvent, Job, UploadInput,
                          Workflow, KnowledgeDocument):
                db.query(model).delete()
    doc_id = int(uuid4().hex[:12], 16)
    with sessions.begin() as db:
        db.add(KnowledgeDocument(id=doc_id, user_id=7, title="Controlled reference", file_name="reference.txt",
            file_url=f"https://fixture.invalid/{doc_id}.txt", file_type="txt", status=1, chunk_count=1,
            visibility="CURATED_PUBLIC", review_status="APPROVED", disease_codes=["glaucoma"],
            topic_codes=["DISEASE_OVERVIEW"], create_time=datetime.now(), update_time=datetime.now()))
    env = os.environ.copy()
    env.update(HUMAN_WAIT_DATABASE_URL=engine.url.render_as_string(hide_password=False),
               HUMAN_WAIT_TRACE=str(tmp_path / "calls.jsonl"), HUMAN_WAIT_DOCUMENT_ID=str(doc_id))
    case = RestartCase(sessions, env, tmp_path)
    try:
        yield case
    finally:
        engine.dispose()
        output = os.getenv("HUMAN_WAIT_EVIDENCE_DIR")
        if output:
            destination = Path(output)
            destination.mkdir(parents=True, exist_ok=True)
            case.evidence["calls"] = case.calls()
            (destination / f"{tmp_path.name}.json").write_text(json.dumps(case.evidence, indent=2), encoding="utf-8")


class RestartCase:
    def __init__(self, sessions, env, directory):
        self.sessions, self.env, self.directory = sessions, env, directory
        self.evidence = {"database": sessions.kw["bind"].dialect.name, "apiPids": [], "workerPids": [], "snapshots": []}
        self.used_ports = set()

    @contextmanager
    def api(self, identity="alice"):
        # Recovery is asserted against durable data/cookies. Avoid reusing a
        # just-terminated Windows listener's transiently unavailable port.
        while True:
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                self.port = listener.getsockname()[1]
            if self.port not in self.used_ports:
                self.used_ports.add(self.port)
                break
        log = (self.directory / f"api-{len(self.evidence['apiPids'])}.log").open("w", encoding="utf-8")
        process = subprocess.Popen([sys.executable, "-m", "web.tests.human_wait_process", "api", "--port", str(self.port)],
            env=self.env, cwd=Path(__file__).resolve().parents[2], stdout=log, stderr=log)
        self.evidence["apiPids"].append(process.pid)
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{self.port}", timeout=20,
                              cookies={SESSION_COOKIE_NAME: identity}) as client:
                deadline = time.monotonic() + 20
                while True:
                    assert process.poll() is None, "API exited; inspect child log"
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    assert time.monotonic() < deadline, "API startup timed out"
                    time.sleep(.05)
                yield client
        finally:
            # Terminate only this child. Windows TerminateProcess demonstrates
            # recovery without relying on application shutdown hooks.
            stop_child(process)
            log.close()
            deadline = time.monotonic() + 5
            while True:
                assert time.monotonic() < deadline, "Old API still serves after process termination"
                with socket.socket() as probe:
                    probe.settimeout(.2)
                    if probe.connect_ex(("127.0.0.1", self.port)) != 0:
                        break
                time.sleep(.05)

    def worker(self, mode="no-inference"):
        process = subprocess.Popen([sys.executable, "-m", "web.tests.human_wait_process", "worker", "--mode", mode],
            env=self.env, cwd=Path(__file__).resolve().parents[2], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.evidence["workerPids"].append(process.pid)
        try:
            output, error = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            stop_child(process)
            process.communicate(timeout=10)
            raise
        assert process.returncode == 0, error
        assert "idle" in output

    def effects(self, workflow_id):
        # Acceptance explicitly asks to correlate HTTP state with durable effects.
        def rows(db, model, condition):
            ordering = [WorkflowEvent.sequence] if model is WorkflowEvent else list(model.__table__.primary_key)
            return [{prop.key: str(getattr(row, prop.key)) for prop in model.__mapper__.column_attrs}
                    for row in db.scalars(select(model).where(condition).order_by(*ordering))]

        with self.sessions() as db:
            result = {"workflowId": workflow_id,
                "inference": rows(db, InferenceEnvelopeRow, InferenceEnvelopeRow.workflow_id == workflow_id),
                "explanations": rows(db, ExplanationSnapshot, ExplanationSnapshot.workflow_id == workflow_id),
                "reviews": rows(db, ReviewTask, ReviewTask.workflow_id == workflow_id),
                "events": rows(db, WorkflowEvent, WorkflowEvent.workflow_id == workflow_id),
                "supplements": rows(db, Supplement, Supplement.workflow_id == workflow_id),
                "confirmations": rows(db, SaveConfirmation, SaveConfirmation.workflow_id == workflow_id),
                "receipts": rows(db, SavedWorkflowDiagnosis, SavedWorkflowDiagnosis.workflow_id == workflow_id),
                "diagnoses": rows(db, Diagnosis, Diagnosis.id.in_(select(SavedWorkflowDiagnosis.diagnosis_id)
                    .where(SavedWorkflowDiagnosis.workflow_id == workflow_id)))}
            workflow = db.get(Workflow, workflow_id)
            result.update(workflowVersion=str(workflow.version), status=workflow.status,
                          stopReason=workflow.stop_reason, graphVersion=workflow.graph_version)
            result["checkpointId"] = db.get(UploadInput, workflow_id).checkpoint_id
        self.evidence["snapshots"].append(result)
        return result

    def calls(self):
        trace = Path(self.env["HUMAN_WAIT_TRACE"])
        return [json.loads(line)["kind"] for line in trace.read_text().splitlines()] if trace.exists() else []


def stop_child(process):
    if process.poll() is None:
        if os.name == "nt":
            # uv's venv launcher can spawn the real interpreter. Stop this
            # owned process tree so a restart cannot reuse its old HTTP server.
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           capture_output=True, check=True, timeout=10)
        else:
            process.kill()
        process.wait(timeout=10)


def view(client, workflow_id):
    response = client.get(f"/api/diagnosis/workflows/{workflow_id}")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def start(client):
    response = create_upload(client, key=uuid4().hex)
    assert response.status_code == 202, response.text
    return response.json()["data"]["workflowId"]


@pytest.mark.parametrize("kind", ["quality", "final"])
def test_doctor_wait_claim_and_submitted_decision_survive_process_restart(restart_case, kind):
    case = restart_case
    with case.api() as client:
        workflow_id = start(client)
        case.worker(kind)
        before = view(client, workflow_id)
        assert before["stopReasonCode"] == ("QUALITY_REVIEW_REQUIRED" if kind == "quality" else "FINAL_CLINICAL_REVIEW_REQUIRED")
        client.cookies.set(SESSION_COOKIE_NAME, "doctor")
        task = next(row for row in client.get("/api/reviews/tasks").json()["data"] if row["workflowId"] == workflow_id)
        review_path = f"/api/reviews/tasks/{task['reviewTaskId']}"
        original = client.get(review_path).json()["data"]
        effects = case.effects(workflow_id)
    with case.api("doctor") as client:
        assert client.get(review_path).json()["data"] == original
        assert case.effects(workflow_id) == effects
        body = versions(original) if kind == "quality" else final_versions(original)
        assert client.post(review_path + "/claim", json=body).status_code == 200
        claimed = client.get(review_path).json()["data"]
    with case.api("doctor") as client:
        assert client.get(review_path).json()["data"] == claimed
        assert client.post(review_path + "/claim", json=body).status_code == 409
        payload = {**(versions(claimed) if kind == "quality" else final_versions(claimed)),
                   "decisionCode": "APPROVE_CONTINUE" if kind == "quality" else "CONFIRM_AI_ASSESSMENT",
                   "reasonCode": "QUALITY_APPROVED" if kind == "quality" else "AI_ASSESSMENT_CONFIRMED"}
        submitted = client.post(review_path + "/submit", json=payload)
        assert submitted.status_code == 200, submitted.text
    with case.api("doctor") as client:
        assert client.post(review_path + "/submit", json=payload).json() == submitted.json()
        case.worker()
        stable = case.effects(workflow_id)
        assert client.post(review_path + "/submit", json=payload).json() == submitted.json()
        assert client.post(review_path + "/submit", json={**payload, "expectedTaskVersion": "99"}).status_code == 409
        case.worker()
        assert case.effects(workflow_id) == stable
        client.cookies.set(SESSION_COOKIE_NAME, "alice")
        after = view(client, workflow_id)
        assert after["progress"]["completed"].count("inference") == 1
        assert after["progress"]["completed"].count("qualityReview" if kind == "quality" else "finalClinicalReview") == 1
        assert after["status"] == "COMPLETED"
        assert stable["inference"] == effects["inference"]
        assert not stable["receipts"]
        if kind == "final":
            assert stable["explanations"][0]["content"] == effects["explanations"][0]["content"]
    assert case.calls().count("inference") == 1
    assert case.calls().count("explanation") == 1


@pytest.mark.parametrize("action", ["approve", "reject", "expired"])
def test_save_confirmation_survives_restart_without_duplicate_or_expired_save(restart_case, action):
    case = restart_case
    expired = action == "expired"
    with case.api() as client:
        workflow_id = start(client)
        case.worker("pass")
        before = view(client, workflow_id)
        total = client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"]
        response = client.post(path(workflow_id), json=requested(before, uuid4().hex))
        assert response.status_code == 200, response.text
        confirmation = response.json()["data"]
        assert confirmation["status"] == "PENDING"
    effects = case.effects(workflow_id)
    assert effects["confirmations"][0]["status"] == "PENDING"
    if expired:
        with case.sessions.begin() as db:
            db.get(SaveConfirmation, confirmation["confirmationId"]).expires_at -= timedelta(hours=1)
    with case.api() as client:
        assert view(client, workflow_id) == before
        if expired:
            assert act(client, confirmation).status_code == 409
            assert client.get(path(workflow_id)).json()["data"]["status"] == "EXPIRED"
            assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == total
            assert not case.effects(workflow_id)["receipts"]
            return
        assert client.get(path(workflow_id)).json()["data"] == confirmation
        assert case.effects(workflow_id) == effects
        client.cookies.set(SESSION_COOKIE_NAME, "bob")
        assert act(client, confirmation).status_code == 403
        client.cookies.set(SESSION_COOKIE_NAME, "alice")
        assert act(client, confirmation, expectedWorkflowVersion="0").status_code == 409
        approved = act(client, confirmation, action)
        assert approved.status_code == 200, approved.text
        assert approved.json()["data"]["status"] == ("APPROVED" if action == "approve" else "REJECTED")
    with case.api() as client:
        assert act(client, confirmation, action).json() == approved.json()
        if action == "reject":
            assert act(client, confirmation).status_code == 409
        stable = case.effects(workflow_id)
        case.worker()
        assert case.effects(workflow_id) == stable
        assert stable["inference"] == effects["inference"]
        assert stable["explanations"] == effects["explanations"]
        assert len(stable["receipts"]) == (1 if action == "approve" else 0)
        assert int(client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"]) == int(total) + (1 if action == "approve" else 0)
    assert case.calls() == ["inference", "explanation"]


@pytest.mark.parametrize("fault,reason", [("graph_version", "GRAPH_VERSION_INCOMPATIBLE"),
    ("graph_hash", "GRAPH_VERSION_INCOMPATIBLE"), ("action_version", "GRAPH_VERSION_INCOMPATIBLE"),
    ("checkpoint", "CHECKPOINT_UNAVAILABLE")])
def test_incompatible_or_missing_continuation_fails_visibly_after_restart(restart_case, fault, reason):
    case = restart_case
    with case.api() as client:
        workflow_id = start(client)
        case.worker("quality")
        client.cookies.set(SESSION_COOKIE_NAME, "doctor")
        task = next(row for row in client.get("/api/reviews/tasks").json()["data"] if row["workflowId"] == workflow_id)
        review_path = f"/api/reviews/tasks/{task['reviewTaskId']}"
        assert client.post(review_path + "/claim", json=versions(task)).status_code == 200
        claimed = client.get(review_path).json()["data"]
        assert client.post(review_path + "/submit", json={**versions(claimed),
            "decisionCode": "APPROVE_CONTINUE", "reasonCode": "QUALITY_APPROVED"}).status_code == 200
        before = case.effects(workflow_id)
    with case.sessions.begin() as db:
        if fault == "checkpoint":
            db.delete(db.get(GraphCheckpoint, (workflow_id, "", before["checkpointId"])))
        else:
            setattr(db.get(Workflow, workflow_id), fault, "incompatible")
    with case.api() as client:
        case.worker()
        after = view(client, workflow_id)
        assert (after["status"], after["stopReasonCode"]) == ("FAILED", reason)
        stable = case.effects(workflow_id)
        assert stable["inference"] == before["inference"]
        assert stable["reviews"] == before["reviews"]
        assert not stable["receipts"]
        assert stable["events"][-1]["reason"] == reason
        case.worker()
        assert case.effects(workflow_id) == stable
    assert case.calls() == ["inference"]


def test_incompatible_supplement_graph_preserves_wait_and_reports_conflict(restart_case):
    case = restart_case
    thread = uuid4().hex
    with case.api() as client:
        workflow_id = start(client)
        assert "event: done" in send(client, thread=thread, workflowId=workflow_id).text
        wait = supplement_event(request_supplement(client, workflow_id, thread=thread))
    with case.sessions.begin() as db:
        db.get(Supplement, wait["requestId"]).graph_version = "incompatible"
    with case.api() as client:
        response = reply(client, wait).json()
        assert response["code"] == 50001 and "版本已变化" in response["msg"]
        assert client.get(f"/api/agent/supplements/{wait['requestId']}").json()["data"] == wait
        history = client.get(f"/api/agent/history/{thread}").json()["data"]
        assert history["supplements"] == [wait]
        assert not any(row["content"] == "左眼的图片，请医生查看" for row in history["messages"])
        case.effects(workflow_id)
    assert not case.calls()


def test_supplement_wait_and_answer_survive_restart_without_replaying_clinical_work(restart_case):
    case = restart_case
    thread = uuid4().hex
    with case.api() as client:
        workflow_id = start(client)
        case.worker("quality")
        assert "event: done" in send(client, thread=thread, workflowId=workflow_id).text
        wait = supplement_event(request_supplement(client, workflow_id, thread=thread))
        before = view(client, workflow_id)
        effects = case.effects(workflow_id)
    with case.api() as client:
        assert client.get(f"/api/agent/supplements/{wait['requestId']}").json()["data"] == wait
        assert client.get(f"/api/agent/history/{thread}").json()["data"]["supplements"] == [wait]
        assert reply(client, wait, version="9").json()["code"] == 50001
        client.cookies.set(SESSION_COOKIE_NAME, "bob")
        assert reply(client, wait).json()["code"] == 40101
        client.cookies.set(SESSION_COOKIE_NAME, "alice")
        answered = reply(client, wait).json()["data"]
        assert answered["status"] == "ANSWERED" and answered["version"] == "1"
    with case.api() as client:
        assert reply(client, wait).json()["data"] == answered
        assert reply(client, wait, text="different answer").json()["code"] == 50001
        history = client.get(f"/api/agent/history/{thread}").json()["data"]
        assert history["supplements"] == [answered]
        assert [row["content"] for row in history["messages"]].count(answered["answer"]) == 1
        new_wait = supplement_event(request_supplement(client, workflow_id, key="new-wait", thread=thread))
        assert new_wait["requestId"] != wait["requestId"]
        assert reply(client, wait).json()["data"] == answered
        assert client.get(f"/api/agent/supplements/{new_wait['requestId']}").json()["data"] == new_wait
        case.worker()
        assert view(client, workflow_id) == before
        clinical = case.effects(workflow_id)
        assert {key: value for key, value in clinical.items() if key != "supplements"} == {
            key: value for key, value in effects.items() if key != "supplements"}
    assert case.calls() == ["inference"]


def test_unreferenced_newer_checkpoint_cannot_override_accepted_quality_decision(restart_case):
    case = restart_case
    with case.api() as client:
        workflow_id = start(client)
        case.worker("quality")
        client.cookies.set(SESSION_COOKIE_NAME, "doctor")
        task = next(row for row in client.get("/api/reviews/tasks").json()["data"] if row["workflowId"] == workflow_id)
        review_path = f"/api/reviews/tasks/{task['reviewTaskId']}"
        assert client.post(review_path + "/claim", json=versions(task)).status_code == 200
        claimed = client.get(review_path).json()["data"]
        assert client.post(review_path + "/submit", json={**versions(claimed),
            "decisionCode": "APPROVE_CONTINUE", "reasonCode": "QUALITY_APPROVED"}).status_code == 200
        committed = case.effects(workflow_id)
    # A checkpoint from an abandoned branch sorts newer than the business token.
    # It must never become the continuation selected by the reconstructed Worker.
    with case.sessions.begin() as db:
        source = db.get(GraphCheckpoint, (workflow_id, "", committed["checkpointId"]))
        serde = MysqlCheckpointSaver(None).serde
        value = serde.loads_typed((source.value_type, source.value))
        orphan_id = "ffffffff-ffff-ffff-ffff-ffffffffffff"
        value["id"] = orphan_id
        value["channel_values"].update(status="REJECTED", reason="ORPHAN_CHECKPOINT", completed=["orphan"])
        value_type, encoded = serde.dumps_typed(value)
        db.add(GraphCheckpoint(thread_id=workflow_id, namespace="", checkpoint_id=orphan_id,
            parent_id=source.checkpoint_id, value_type=value_type, value=encoded, metadata_json=source.metadata_json))
    with case.api() as client:
        case.worker()
        after = view(client, workflow_id)
        assert after["status"] == "COMPLETED", after
        assert after["qualityReview"]["decisionCode"] == "APPROVE_CONTINUE"
        assert "orphan" not in after["progress"]["completed"]
        stable = case.effects(workflow_id)
        assert stable["inference"] == committed["inference"]
        assert stable["checkpointId"] != orphan_id
        assert stable["reviews"] == committed["reviews"]
    assert case.calls() == ["inference", "explanation"]

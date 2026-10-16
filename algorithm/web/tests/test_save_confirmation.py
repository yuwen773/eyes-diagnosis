"""Issue11 production HTTP/worker seams, controlled SQLite/Java/model/evidence."""

import json
import subprocess
import sys
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker

from web.models.diagnosis import Diagnosis
from web.tests.test_controlled_evidence import evidence_api, govern
from web.tests.test_validated_explanation import explanation_api, start, read, drain
from web.workflow.confirmation_models import SaveConfirmation, SavedWorkflowDiagnosis
from web.workflow.models import ExplanationSnapshot, ReviewTask, Workflow, UploadInput
from web.tests.session_fixtures import SESSION_COOKIE_NAME, install_sessions  # noqa: E402


def path(task):
    return f"/api/diagnosis/workflows/{task}/save-confirmation"


def requested(view, key="save-1"):
    return {"idempotencyKey": key, "expectedWorkflowVersion": view["workflowVersion"],
        "expectedExplanationSnapshotId": view["explanation"]["snapshotId"],
        "expectedExplanationRevision": view["explanation"]["revision"]}


def decision(row):
    return {"idempotencyKey": row["idempotencyKey"], "expectedContentDigest": row["contentDigest"],
        "expectedWorkflowVersion": row["workflowVersion"]}


def act(client, row, action="approve", **changes):
    return client.post(f'/api/diagnosis/workflows/{row["workflowId"]}/save-confirmations/'
        f'{row["confirmationId"]}/{action}', json={**decision(row), **changes})


def prepare(api):
    client, sessions, *_ = api
    task = start(client)
    drain(sessions)
    view = read(client, task)
    response = client.post(path(task), json=requested(view))
    assert response.status_code == 200, response.text
    return client, sessions, task, view, response.json()["data"]


def count(sessions):
    with sessions() as db:
        return db.scalar(select(func.count()).select_from(Diagnosis))


@pytest.mark.parametrize("token", ["graph_version", "graph_hash", "action_version"])
def test_incompatible_graph_cannot_consume_pending_save_authorization(explanation_api, token):
    client, sessions, task, view, row = prepare(explanation_api)
    with sessions.begin() as db:
        setattr(db.get(Workflow, task), token, "incompatible-release")
    response = act(client, row)
    assert response.status_code == 409, response.text
    assert "图版本" in response.text
    assert client.get(path(task)).json()["data"] == row
    assert client.post(path(task), json=requested(view, "new-release")).status_code == 409
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


def test_preview_is_not_save_and_approval_saves_exactly_once(explanation_api):
    client, sessions, task, view, row = prepare(explanation_api)
    assert row["status"] == "PENDING" and count(sessions) == 0
    assert row["content"]["explanation"] == view["result"]
    assert client.post(path(task), json=requested(view)).json()["data"] == row
    assert client.post(path(task), json=requested(view, "another-key")).json()["data"] == row
    assert client.get(path(task)).json()["data"] == row
    image = client.get(row["content"]["imageUrl"])
    assert image.status_code == 200 and image.headers["content-type"] == "image/png"
    approved = act(client, row)
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["status"] == "APPROVED"
    assert count(sessions) == 1
    assert act(client, row).json() == approved.json()
    assert client.post(path(task), json=requested(view, "new-key")).json() == approved.json()
    with sessions() as db:
        saved = db.scalar(select(Diagnosis))
        receipt = db.get(SavedWorkflowDiagnosis, task)
        assert str(saved.id) == approved.json()["data"]["diagnosisId"]
        assert receipt.diagnosis_id == saved.id
        assert saved.url == row["content"]["imageUrl"]
        assert saved.result == row["content"]["result"]
        assert saved.calibrated_probability == row["content"]["calibratedProbability"]
        assert saved.details == row["content"]["details"]
        assert saved.severity == "NOT_ASSESSED" and saved.human_review_status == "AI_ONLY"
        assert json.loads(db.get(SaveConfirmation, row["confirmationId"]).content) == row["content"]
    assert read(client, task)["workflowVersion"] == view["workflowVersion"]
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "1"
    client.cookies.set(SESSION_COOKIE_NAME, "admin")
    assert client.get(row["content"]["imageUrl"]).status_code == 200
    assert client.get(path(task)).status_code == 403
    assert client.get(f"/api/diagnosis/workflows/{task}").status_code == 403


def test_reject_replay_and_expiry_do_not_save(explanation_api):
    client, sessions, task, view, row = prepare(explanation_api)
    rejected = act(client, row, "reject")
    assert rejected.json()["data"]["status"] == "REJECTED"
    assert act(client, row, "reject").json() == rejected.json()
    assert act(client, row).status_code == 409 and count(sessions) == 0
    new = client.post(path(task), json=requested(view, "new")).json()["data"]
    with sessions.begin() as db:
        db.get(SaveConfirmation, new["confirmationId"]).expires_at -= timedelta(hours=1)
    assert act(client, new).status_code == 409
    with sessions() as db:
        assert db.get(SaveConfirmation, new["confirmationId"]).status == "EXPIRED"
    assert count(sessions) == 0


@pytest.mark.parametrize("change", ["workflow", "explanation", "image", "review", "source", "operation"])
def test_changed_versions_content_and_gates_never_save(explanation_api, change):
    client, sessions, task, _, row = prepare(explanation_api)
    with sessions.begin() as db:
        if change == "workflow":
            db.get(Workflow, task).version += 1
        elif change == "explanation":
            snapshot = db.scalar(select(ExplanationSnapshot))
            content = json.loads(snapshot.content)
            content["riskNotice"] += "变更"
            snapshot.content = json.dumps(content)
        elif change == "image":
            db.get(UploadInput, task).image_bytes = b"changed"
        elif change == "review":
            db.get(Workflow, task).status = "WAITING_HUMAN_REVIEW"
        elif change == "operation":
            db.get(SaveConfirmation, row["confirmationId"]).operation = "OTHER"
    if change == "source":
        client.cookies.set(SESSION_COOKIE_NAME, "admin")
        assert govern(client, explanation_api[2], reviewStatus="WITHDRAWN", expectedVersion=1).status_code == 200
        client.cookies.set(SESSION_COOKIE_NAME, "alice")
    assert act(client, row).status_code == 409 and count(sessions) == 0
    if change != "operation":
        with sessions() as db:
            assert db.get(SaveConfirmation, row["confirmationId"]).status == "INVALIDATED"


def test_permissions_payload_tampering_and_wrong_resource(explanation_api):
    client, sessions, task, view, row = prepare(explanation_api)
    for identity, status in [("bob", 403), ("admin", 403), ("missing", 401)]:
        client.cookies.set(SESSION_COOKIE_NAME, identity)
        assert client.get(path(task)).status_code == status
        assert client.post(path(task), json=requested(view)).status_code == status
        assert act(client, row).status_code == status
        assert act(client, row, "reject").status_code == status
        assert client.get(row["content"]["imageUrl"]).status_code == status
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    for changes in [{"idempotencyKey": "other"}, {"expectedContentDigest": "a" * 64},
                    {"expectedWorkflowVersion": "0"}]:
        assert act(client, row, **changes).status_code == 409
    assert act(client, row, content={"result": "normal"}).status_code == 422
    other = start(client, key="other-workflow")
    assert act(client, {**row, "workflowId": other}).status_code == 403
    assert client.post(path(other), json=requested(view)).status_code == 409
    assert count(sessions) == 0


def test_waiting_doctor_cannot_be_saved_and_doctor_is_not_user_consent(explanation_api):
    from web.tests.test_final_clinical_review import prepare as clinical_prepare, claim, final_versions, run
    client, sessions, _, _, task, review_path, detail, _, adapter = clinical_prepare(explanation_api)
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    pending = read(client, task)
    assert client.post(path(task), json=requested(pending)).status_code == 409
    client.cookies.set(SESSION_COOKIE_NAME, "doctor")
    claimed = claim(client, review_path, detail)
    assert client.post(review_path + "/submit", json={**final_versions(claimed),
        "decisionCode": "CONFIRM_AI_ASSESSMENT", "reasonCode": "AI_ASSESSMENT_CONFIRMED"}).status_code == 200
    run(sessions, adapter)
    assert count(sessions) == 0
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    assert client.get(path(task)).json()["data"] is None
    row = client.post(path(task), json=requested(read(client, task))).json()["data"]
    assert act(client, row).status_code == 200 and count(sessions) == 1
    with sessions() as db:
        saved = db.scalar(select(Diagnosis))
        assert saved.human_review_status == "REVIEWED" and saved.human_reviewer_id == 10


def test_failed_transaction_leaves_consent_pending_and_retry_saves_once(explanation_api):
    client, sessions, _, _, row = prepare(explanation_api)
    def fail_insert(*args):
        raise RuntimeError("controlled insert failure")
    event.listen(Diagnosis, "before_insert", fail_insert)
    try:
        with pytest.raises(RuntimeError, match="controlled insert failure"):
            act(client, row)
    finally:
        event.remove(Diagnosis, "before_insert", fail_insert)
    assert count(sessions) == 0
    assert client.get(path(row["workflowId"])).json()["data"]["status"] == "PENDING"
    assert act(client, row).status_code == 200
    assert count(sessions) == 1


def copy_database(sessions, filename):
    engine = create_engine(f"sqlite:///{filename}")
    with sessions.kw["bind"].connect() as source, engine.connect() as target:
        source.connection.driver_connection.backup(target.connection.driver_connection)
    return sessionmaker(engine, expire_on_commit=False)


def approval_process(filename, row):
    # A fresh interpreter constructs the API and reads pending consent from disk.
    script = '''
import json, sys
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from web.app import create_app
from web.config import WebConfig
from web.deps import get_db
from web.tests.session_fixtures import SESSION_COOKIE_NAME, install_sessions
app = create_app(WebConfig())
engine = create_engine("sqlite:///" + sys.argv[1])
sessions = sessionmaker(engine, expire_on_commit=False)
def database():
    with sessions() as db:
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
app.dependency_overrides[get_db] = database
auth = install_sessions(app, engine)
row = json.loads(sys.argv[2])
client = TestClient(app)
client.cookies.set(SESSION_COOKIE_NAME, "alice")
before = client.get("/api/diagnosis/workflows/" + row["workflowId"] + "/save-confirmation").json()["data"]
response = client.post("/api/diagnosis/workflows/" + row["workflowId"] + "/save-confirmations/" + row["confirmationId"] + "/approve", json={
    "idempotencyKey": row["idempotencyKey"], "expectedContentDigest": row["contentDigest"],
    "expectedWorkflowVersion": row["workflowVersion"]})
print(json.dumps({"before": before["status"], "status": response.status_code, "body": response.json()}))
'''
    return subprocess.Popen([sys.executable, "-c", script, str(filename), json.dumps(row)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def result(process):
    stdout, stderr = process.communicate(timeout=45)
    assert process.returncode == 0, stderr
    return json.loads(stdout)


def test_pending_and_approved_consent_survive_fresh_api_processes(explanation_api, tmp_path):
    _, sessions, _, _, row = prepare(explanation_api)
    filename = tmp_path / "consent.db"
    durable = copy_database(sessions, filename)
    first = result(approval_process(filename, row))
    second = result(approval_process(filename, row))
    assert first["before"] == "PENDING" and second["before"] == "APPROVED"
    assert first["status"] == second["status"] == 200
    assert first["body"] == second["body"]
    assert count(durable) == 1
    durable.kw["bind"].dispose()


def test_concurrent_api_processes_cannot_duplicate_formal_save(explanation_api, tmp_path):
    _, sessions, _, _, row = prepare(explanation_api)
    filename = tmp_path / "concurrent.db"
    durable = copy_database(sessions, filename)
    processes = [approval_process(filename, row) for _ in range(2)]
    responses = [result(process) for process in processes]
    assert all(response["status"] in {200, 409} for response in responses)
    assert any(response["status"] == 200 for response in responses)
    assert count(durable) == 1
    assert result(approval_process(filename, row))["status"] == 200
    durable.kw["bind"].dispose()

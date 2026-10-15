"""Final clinical review through production HTTP/graph with controlled services."""

import asyncio
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from web.tests.test_controlled_evidence import evidence_api, govern
from web.tests.test_validated_explanation import explanation_api, start, read
from web.tests.test_quality_review import versions
from web.tests.test_workflow import workflow_api
from web.app import create_app
from web.deps import get_db
from fastapi.testclient import TestClient
from web.tests.test_workflow_inference import ControlledEngine, prediction
from web.config import WebConfig
from web.workflow.inference import WorkflowInference
from web.workflow.models import ExplanationSnapshot, InferenceEnvelopeRow, WorkflowEvent
from web.workflow.worker import Worker
from web.tests.session_fixtures import (  # noqa: E402
    SESSION_COOKIE_NAME,
    Identity,
    install_sessions,
)

REASONS = {"CONFIRM_AI_ASSESSMENT": "AI_ASSESSMENT_CONFIRMED",
    "CORRECT_AI_ASSESSMENT": "AI_ASSESSMENT_CORRECTED", "INCONCLUSIVE": "INCONCLUSIVE",
    "CONFIRM_ABSTENTION": "ABSTENTION_CONFIRMED", "PROVIDE_INDEPENDENT_REVIEW": "INDEPENDENT_REVIEW_PROVIDED"}


#: The doctor-review matrix. Two things are deliberate:
#:
#: ``alice`` (id 7) carries the **doctor** role, because ``self-doctor`` in the
#: tests below is the same user id and is expected to be refused *as the owner*
#: -- ``review.py#authorize`` raises 403 on ``owner_user_id == user.id``. If
#: alice were an ordinary user she would be refused by the role check instead,
#: and the ownership guard would have no test at all.
#:
#: ``other-doctor`` (id 11) exists to prove a second doctor is refused because
#: the task was already claimed, not because of who they are.
FINAL_IDENTITIES = {
    "alice": Identity(7, "alice", "doctor", "Alice"),
    "bob": Identity(8, "bob", "user", "Bob"),
    "admin": Identity(9, "admin", "admin", "Admin"),
    "doctor": Identity(10, "doctor", "doctor", "Doctor"),
    "other-doctor": Identity(11, "other-doctor", "doctor", "Other Doctor"),
    # Same row as alice: the refusal has to come from ownership, not the role.
    "self-doctor": Identity(7, "alice", "doctor", "Alice"),
}


def identities(client):
    """Install the matrix on the app behind ``client``.

    Re-installing rather than mutating is what lets a rebuilt app pick the same
    identities up, which ``test_final_wait_survives_app_restart...`` needs.
    """
    return install_sessions(client.app, who=FINAL_IDENTITIES)


def run(sessions, adapter):
    for _ in range(25):
        if not Worker(sessions, inference=adapter).run_once():
            return
    pytest.fail("graph did not stop")


def prepare(explanation_api, abstained=False):
    client, sessions, doc_id, model = explanation_api
    identities(client)
    task = start(client, question="请医生查看本次眼底图片")
    engine = ControlledEngine(prediction(requires_review=True, rejected=abstained,
        is_ood=abstained, abstain_reason="OOD" if abstained else ""))
    adapter = WorkflowInference(WebConfig(dashscope_api_key="controlled-key"), engine=engine)
    run(sessions, adapter)
    assert read(client, task)["status"] == "WAITING_HUMAN_REVIEW"
    client.cookies.set(SESSION_COOKIE_NAME, "doctor")
    listed = client.get("/api/reviews/tasks").json()["data"]
    review = next(row for row in listed if row["workflowId"] == task)
    path = f'/api/reviews/tasks/{review["reviewTaskId"]}'
    detail = client.get(path).json()["data"]
    return client, sessions, doc_id, model, task, path, detail, engine, adapter


def final_versions(detail):
    explanation = detail["explanation"]
    return {**versions(detail), "expectedExplanationSnapshotId": explanation["snapshotId"],
            "expectedExplanationRevision": explanation["revision"]}


def claim(client, path, detail):
    response = client.post(path + "/claim", json=final_versions(detail))
    assert response.status_code == 200, response.text
    return client.get(path).json()["data"]


@pytest.mark.parametrize("abstained,decision", [(False, "CONFIRM_AI_ASSESSMENT"),
    (False, "CORRECT_AI_ASSESSMENT"), (False, "INCONCLUSIVE"), (True, "CONFIRM_ABSTENTION"),
    (True, "PROVIDE_INDEPENDENT_REVIEW"), (True, "INCONCLUSIVE")])
def test_matrix_replay_and_resume_preserve_ai_and_do_not_save(explanation_api, abstained, decision):
    client, sessions, _, model, task, path, detail, engine, adapter = prepare(explanation_api, abstained)
    assert detail["reviewType"] == "FINAL_CLINICAL_REVIEW"
    assert detail["question"] == "请医生查看本次眼底图片"
    assert detail["allowedDecisions"] == (["CONFIRM_ABSTENTION", "PROVIDE_INDEPENDENT_REVIEW", "INCONCLUSIVE"]
        if abstained else ["CONFIRM_AI_ASSESSMENT", "CORRECT_AI_ASSESSMENT", "INCONCLUSIVE"])
    assert detail["inferenceOutcome"] == ("SAFETY_ABSTENTION" if abstained else "VALID_PREDICTION")
    with sessions() as db:
        row = db.scalar(select(InferenceEnvelopeRow))
        original = {column.name: getattr(row, prop.key) for prop in row.__mapper__.column_attrs for column in prop.columns}
        explanation = db.scalar(select(ExplanationSnapshot))
        content = explanation.content if explanation else None
    claimed = claim(client, path, detail)
    body = {**final_versions(claimed), "decisionCode": decision, "reasonCode": REASONS[decision]}
    first = client.post(path + "/submit", json=body)
    assert first.status_code == 200, first.text
    assert client.post(path + "/submit", json=body).json() == first.json()
    # Reconstructed worker uses the durable checkpoint and must never infer again.
    unavailable = ControlledEngine(RuntimeError("must not infer on review resume"))
    run(sessions, WorkflowInference(WebConfig(dashscope_api_key="controlled-key"), engine=unavailable))
    assert client.post(path + "/submit", json=body).json() == first.json()
    assert client.get(path).json()["data"]["allowedDecisions"] == []
    assert engine.calls == 1 and unavailable.calls == 0
    assert len(model["requests"]) == (0 if abstained else 1)
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    view = read(client, task)
    published = decision == "CONFIRM_AI_ASSESSMENT"
    assert view["status"] == ("COMPLETED" if published else "COMPLETED_LIMITED")
    assert view["explanation"]["publicationStatus"] == ("NONE" if abstained else "PUBLISHED" if published else "WITHHELD")
    assert (view["result"] is not None) == published
    assert view["finalReview"]["decisionCode"] == decision
    assert [event["eventType"] for event in view["finalReview"]["audit"]][:2] == [
        "FINAL_REVIEW_CLAIMED", "FINAL_REVIEW_SUBMITTED"]
    assert view["progress"]["completed"].count("finalClinicalReview") == 1
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
    with sessions() as db:
        row = db.scalar(select(InferenceEnvelopeRow))
        assert original == {column.name: getattr(row, prop.key) for prop in row.__mapper__.column_attrs for column in prop.columns}
        snapshot = db.scalar(select(ExplanationSnapshot))
        assert (snapshot.content if snapshot else None) == content
        events = list(db.scalars(select(WorkflowEvent).where(WorkflowEvent.actor_type == "DOCTOR")))
        assert [event.event_type for event in events] == ["FINAL_REVIEW_CLAIMED", "FINAL_REVIEW_SUBMITTED"]
        assert all(detail["inferenceEnvelopeId"] in event.payload for event in events)
        if not abstained:
            assert db.scalar(select(WorkflowEvent).where(WorkflowEvent.event_type ==
                ("EXPLANATION_PUBLISHED" if published else "EXPLANATION_WITHHELD"))) is not None


@pytest.mark.parametrize("abstained,decision", [(False, "CONFIRM_ABSTENTION"), (False, "APPROVE_CONTINUE"),
    (True, "CONFIRM_AI_ASSESSMENT"), (True, "CORRECT_AI_ASSESSMENT")])
def test_incompatible_decision_matrix_is_rejected(explanation_api, abstained, decision):
    client, _, _, _, _, path, detail, *_ = prepare(explanation_api, abstained)
    detail = claim(client, path, detail)
    response = client.post(path + "/submit", json={**final_versions(detail), "decisionCode": decision,
        "reasonCode": REASONS.get(decision, "QUALITY_APPROVED")})
    assert response.status_code == 422
    assert client.get(path).json()["data"]["status"] == "CLAIMED"


def test_permissions_claim_conflict_versions_and_forbidden_fields(explanation_api):
    client, _, _, _, task, path, detail, *_ = prepare(explanation_api)
    for name, status in [("alice", 403), ("bob", 403), ("admin", 403), ("self-doctor", 403), ("missing", 401)]:
        client.cookies.set(SESSION_COOKIE_NAME, name)
        assert client.get(path).status_code == status
        assert client.get(path + "/image").status_code == status
        assert client.post(path + "/claim", json=final_versions(detail)).status_code == status
    client.cookies.set(SESSION_COOKIE_NAME, "doctor")
    body = {**final_versions(detail), "decisionCode": "CONFIRM_AI_ASSESSMENT", "reasonCode": "AI_ASSESSMENT_CONFIRMED"}
    assert client.post(path + "/submit", json=body).status_code == 409
    claimed = claim(client, path, detail)
    assert client.post(path + "/claim", json=final_versions(detail)).status_code == 409
    client.cookies.set(SESSION_COOKIE_NAME, "other-doctor")
    assert client.get(path).status_code == 403
    assert client.get(path + "/image").status_code == 403
    assert client.post(path + "/submit", json=body).status_code == 403
    client.cookies.set(SESSION_COOKIE_NAME, "doctor")
    body.update(final_versions(claimed))
    for change, status in [({"expectedTaskVersion": "0"}, 409), ({"expectedWorkflowVersion": "0"}, 409),
        ({"expectedExplanationRevision": "99"}, 409), ({"expectedExplanationSnapshotId": "other"}, 409),
        ({"reasonCode": "INCONCLUSIVE"}, 422), ({"nextNode": "explanationPublication"}, 422),
        ({"modelAssessment": {}}, 422)]:
        assert client.post(path + "/submit", json={**body, **change}).status_code == status
    assert client.post(path + "/submit", json=body).status_code == 200
    assert client.post(path + "/submit", json={**body, "expectedExplanationRevision": "99"}).status_code == 409
    client.cookies.set(SESSION_COOKIE_NAME, "bob")
    assert client.get(f"/api/diagnosis/workflows/{task}").status_code == 403


def test_approval_cannot_publish_revoked_sources_or_restart_retrieval(explanation_api):
    client, sessions, doc_id, model, task, path, detail, _, adapter = prepare(explanation_api)
    detail = claim(client, path, detail)
    client.cookies.set(SESSION_COOKIE_NAME, "admin")
    assert govern(client, doc_id, reviewStatus="WITHDRAWN", expectedVersion=1).json()["code"] == 0
    client.cookies.set(SESSION_COOKIE_NAME, "doctor")
    body = {**final_versions(detail), "decisionCode": "CONFIRM_AI_ASSESSMENT", "reasonCode": "AI_ASSESSMENT_CONFIRMED"}
    assert client.post(path + "/submit", json=body).status_code == 200
    run(sessions, adapter)
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    view = read(client, task)
    assert view["status"] == "COMPLETED_LIMITED" and view["result"] is None
    assert view["explanation"]["publicationStatus"] == "WITHHELD"
    assert view["progress"]["completed"].count("evidenceRetrieval") == 1
    assert len(model["requests"]) == 1


def test_final_wait_survives_app_restart_and_independent_worker_process(workflow_api):
    client, sessions = workflow_api
    identities(client)
    task_id = start(client)
    engine = ControlledEngine(prediction(rejected=True, is_ood=True, requires_review=True))
    run(sessions, WorkflowInference(WebConfig(), engine=engine))
    original = read(client, task_id)
    app = create_app(WebConfig())
    app.dependency_overrides[get_db] = client.app.dependency_overrides[get_db]
    # A fresh process starts with an empty session store, so the restarted app
    # is given the same identities -- not just the same database.
    install_sessions(app, who=FINAL_IDENTITIES)
    restarted = TestClient(app)
    try:
        restarted.cookies.set(SESSION_COOKIE_NAME, "alice")
        assert read(restarted, task_id) == original
        restarted.cookies.set(SESSION_COOKIE_NAME, "doctor")
        task = restarted.get("/api/reviews/tasks").json()["data"][0]
        path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
        detail = claim(restarted, path, restarted.get(path).json()["data"])
        body = {**final_versions(detail), "decisionCode": "CONFIRM_ABSTENTION", "reasonCode": "ABSTENTION_CONFIRMED"}
        assert restarted.post(path + "/submit", json=body).status_code == 200
        script = """
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from web.workflow.worker import Worker
engine = create_engine(sys.argv[1])
worker = Worker(sessionmaker(engine, expire_on_commit=False))
assert worker.run_once()
assert not worker.run_once()
engine.dispose()
"""
        result = subprocess.run([sys.executable, "-c", script, str(sessions.kw["bind"].url)],
            capture_output=True, text=True, timeout=30, cwd=Path(__file__).resolve().parents[2])
        assert result.returncode == 0, result.stderr
        assert restarted.post(path + "/submit", json=body).status_code == 200
        restarted.cookies.set(SESSION_COOKIE_NAME, "alice")
        assert read(restarted, task_id)["status"] == "COMPLETED_LIMITED"
        assert read(restarted, task_id)["finalReview"]["decisionCode"] == "CONFIRM_ABSTENTION"
        assert engine.calls == 1
    finally:
        restarted.close()


@pytest.mark.parametrize("field,value", [("revision", 99), ("content", "{}"),
    ("validation", '{"status":"REJECTED"}'), ("publication_status", "WITHHELD")])
def test_changed_business_snapshot_cannot_be_approved(explanation_api, field, value):
    client, sessions, _, _, task_id, path, detail, *_ = prepare(explanation_api)
    with sessions.begin() as db:
        row = db.scalar(select(ExplanationSnapshot).where(ExplanationSnapshot.workflow_id == task_id))
        setattr(row, field, value)
    assert client.post(path + "/claim", json=final_versions(detail)).status_code == 409


def test_quality_and_final_reviews_remain_independent_on_same_case(explanation_api):
    client, sessions, _, model = explanation_api
    identities(client)
    task_id = start(client)
    engine = ControlledEngine(prediction(requires_review=True, quality_reasons="blur"))
    adapter = WorkflowInference(WebConfig(dashscope_api_key="controlled-key"), engine=engine)
    run(sessions, adapter)
    client.cookies.set(SESSION_COOKIE_NAME, "doctor")
    task = client.get("/api/reviews/tasks").json()["data"][0]
    assert task["reviewType"] == "IMAGE_QUALITY_GATE"
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    claimed = client.post(path + "/claim", json=versions(task)).json()["data"]
    assert client.post(path + "/submit", json={**versions(claimed), "decisionCode": "APPROVE_CONTINUE",
        "reasonCode": "QUALITY_APPROVED"}).status_code == 200
    run(sessions, adapter)
    task = client.get("/api/reviews/tasks").json()["data"][0]
    assert task["reviewType"] == "FINAL_CLINICAL_REVIEW"
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    detail = claim(client, path, client.get(path).json()["data"])
    assert client.post(path + "/submit", json={**final_versions(detail), "decisionCode": "CORRECT_AI_ASSESSMENT",
        "reasonCode": "AI_ASSESSMENT_CORRECTED"}).status_code == 200
    run(sessions, adapter)
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    view = read(client, task_id)
    assert view["qualityReview"]["decisionCode"] == "APPROVE_CONTINUE"
    assert view["finalReview"]["decisionCode"] == "CORRECT_AI_ASSESSMENT"
    assert view["status"] == "COMPLETED_LIMITED" and view["result"] is None
    assert engine.calls == 1 and len(model["requests"]) == 1

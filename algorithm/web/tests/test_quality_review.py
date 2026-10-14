"""Quality review through HTTP and durable production graph, with service doubles."""

import asyncio
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from web.config import WebConfig
from web.tests.test_workflow import create_upload, workflow_api
from web.tests.test_workflow_inference import ControlledEngine, prediction, query
from web.workflow.inference import WorkflowInference
from web.workflow.models import InferenceEnvelopeRow
from web.workflow.worker import Worker
from web.app import create_app
from web.deps import get_db


def doctor(client, name="doctor"):
    client.cookies.set("SESSION", name)


def prepare(workflow_api, result=None):
    client, sessions = workflow_api

    def java(request):
        name = request.headers["cookie"].split("=")[-1]
        identity = {"alice": (7, "user"), "bob": (8, "user"),
                    "doctor": (9, "doctor"), "other-doctor": (10, "doctor"),
                    "self-doctor": (7, "doctor"), "admin": (11, "admin")}.get(name)
        return httpx.Response(200, json={"code": 0 if identity else 40100, "data": {
            "id": str(identity[0]), "userAccount": name, "userRole": identity[1],
        } if identity else None})

    client.app.state.java_client._transport = httpx.MockTransport(java)
    engine = ControlledEngine(result or prediction(quality_reasons="blur", quality_score=40))
    worker = Worker(sessions, inference=WorkflowInference(WebConfig(), engine=engine))
    workflow_id = create_upload(client, question="本次眼底图片").json()["data"]["workflowId"]
    for _ in range(3):
        assert worker.run_once()
    assert not worker.run_once()
    doctor(client)
    return client, sessions, engine, workflow_id


def versions(task):
    return {"expectedTaskVersion": task["taskVersion"],
            "expectedWorkflowVersion": task["workflowVersion"]}


def test_doctor_approval_resumes_original_inference_once_after_restart(workflow_api):
    client, sessions, engine, workflow_id = prepare(workflow_api)
    tasks = client.get("/api/reviews/tasks")
    assert tasks.status_code == 200
    task = tasks.json()["data"][0]
    assert task["reviewType"] == "IMAGE_QUALITY_GATE"
    task_id = task["reviewTaskId"]
    claimed = client.post(f"/api/reviews/tasks/{task_id}/claim", json=versions(task))
    assert claimed.status_code == 200
    detail = client.get(f"/api/reviews/tasks/{task_id}").json()["data"]
    assert detail["question"] == "本次眼底图片"
    assert detail["allowedDecisions"] == ["APPROVE_CONTINUE", "REJECT_RESUBMIT"]
    with sessions() as db:
        row = db.scalar(select(InferenceEnvelopeRow))
        original = {column.key: getattr(row, column.key) for column in row.__mapper__.column_attrs}
    decision = {**versions(detail), "decisionCode": "APPROVE_CONTINUE",
                "reasonCode": "QUALITY_APPROVED"}
    submitted = client.post(f"/api/reviews/tasks/{task_id}/submit", json=decision)
    assert submitted.status_code == 200
    assert client.post(f"/api/reviews/tasks/{task_id}/submit", json=decision).status_code == 200
    # Fresh worker and graph instances must continue the recorded segment.
    unavailable = ControlledEngine(RuntimeError("must reuse original inference"))
    for _ in range(6):
        assert Worker(sessions, inference=WorkflowInference(WebConfig(), engine=unavailable)).run_once()
    assert not Worker(sessions).run_once()
    doctor(client, "alice")
    view = query(client, workflow_id)
    assert view["qualityReview"]["decisionCode"] == "APPROVE_CONTINUE"
    assert view["stopReasonCode"] == "EVIDENCE_INSUFFICIENT"
    assert view["progress"]["completed"] == ["validateImage", "inference", "imageQuality",
                                               "qualityReview", "visionExposure", "clinicalRiskPrecheck", "evidenceRetrieval",
                                               "evidenceRewrite", "evidenceValidation"]
    assert view["result"] is None
    assert engine.calls == 1 and unavailable.calls == 0
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
    with sessions() as db:
        rows = list(db.scalars(select(InferenceEnvelopeRow)))
        assert len(rows) == 1
        assert {column.key: getattr(rows[0], column.key) for column in rows[0].__mapper__.column_attrs} == original


def test_doctor_rejection_requests_reupload_without_vision_or_reinference(workflow_api):
    client, sessions, engine, workflow_id = prepare(workflow_api)
    task = client.get("/api/reviews/tasks").json()["data"][0]
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    task = client.post(path + "/claim", json=versions(task)).json()["data"]
    body = {**versions(task), "decisionCode": "REJECT_RESUBMIT", "reasonCode": "QUALITY_REJECTED"}
    assert client.post(path + "/submit", json=body).status_code == 200
    assert Worker(sessions).run_once()
    assert not Worker(sessions).run_once()
    assert client.post(path + "/submit", json=body).status_code == 200
    doctor(client, "alice")
    view = query(client, workflow_id)
    assert (view["status"], view["stopReasonCode"]) == ("REJECTED", "QUALITY_REJECTED")
    assert view["qualityReview"]["decisionCode"] == "REJECT_RESUBMIT"
    assert "visionExposure" not in view["progress"]["completed"]
    assert engine.calls == 1


@pytest.mark.parametrize("identity,status", [("alice", 403), ("admin", 403), ("self-doctor", 403),
                                             ("expired", 401)])
def test_review_requires_doctor_and_forbids_own_case(workflow_api, identity, status):
    client, _, _, _ = prepare(workflow_api)
    task = client.get("/api/reviews/tasks").json()["data"][0]
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    doctor(client, identity)
    for suffix in ("", "/image"):
        assert client.get(path + suffix).status_code == status
    assert client.post(path + "/claim", json=versions(task)).status_code == status
    assert client.post(path + "/submit", json={**versions(task), "decisionCode": "APPROVE_CONTINUE",
                                              "reasonCode": "QUALITY_APPROVED"}).status_code == status
    listed = client.get("/api/reviews/tasks")
    assert listed.status_code == (200 if identity == "self-doctor" else status)
    if identity == "self-doctor":
        assert listed.json()["data"] == []


def test_unclaimed_stale_and_other_doctor_cannot_submit_or_overwrite(workflow_api):
    client, _, _, _ = prepare(workflow_api)
    task = client.get("/api/reviews/tasks").json()["data"][0]
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    body = {**versions(task), "decisionCode": "APPROVE_CONTINUE", "reasonCode": "QUALITY_APPROVED"}
    assert client.post(path + "/submit", json=body).status_code == 409
    claimed = client.post(path + "/claim", json=versions(task)).json()["data"]
    assert client.post(path + "/claim", json=versions(task)).status_code == 409
    assert client.post(path + "/submit", json=body).status_code == 409
    doctor(client, "other-doctor")
    assert client.get("/api/reviews/tasks").json()["data"] == []
    assert client.get(path).status_code == 403
    assert client.get(path + "/image").status_code == 403
    assert client.post(path + "/claim", json=versions(claimed)).status_code == 403
    body.update(versions(claimed))
    assert client.post(path + "/submit", json=body).status_code == 403
    doctor(client)
    assert client.post(path + "/submit", json=body).status_code == 200
    body.update(decisionCode="REJECT_RESUBMIT", reasonCode="QUALITY_REJECTED")
    assert client.post(path + "/submit", json=body).status_code == 409


@pytest.mark.parametrize("change", [{"decisionCode": "CONFIRM_AI_ASSESSMENT"},
    {"reasonCode": "QUALITY_REJECTED"}, {"nextNode": "visionExposure"},
    {"predictionSnapshot": "normal"}, {"userId": "9"}, {"expectedTaskVersion": "-1"}])
def test_quality_decisions_cannot_confirm_disease_change_source_or_route(workflow_api, change):
    client, sessions, _, _ = prepare(workflow_api)
    task = client.get("/api/reviews/tasks").json()["data"][0]
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    claimed = client.post(path + "/claim", json=versions(task)).json()["data"]
    body = {**versions(claimed), "decisionCode": "APPROVE_CONTINUE", "reasonCode": "QUALITY_APPROVED", **change}
    assert client.post(path + "/submit", json=body).status_code == 422
    assert client.get(path).json()["data"]["status"] == "CLAIMED"
    assert not Worker(sessions).run_once()


@pytest.mark.parametrize("changed", ["workflow", "graph", "checkpoint", "envelope"])
def test_changed_workflow_or_recovery_binding_rejects_submission(workflow_api, changed):
    from web.workflow.models import UploadInput, Workflow

    client, sessions, _, workflow_id = prepare(workflow_api)
    task = client.get("/api/reviews/tasks").json()["data"][0]
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    claimed = client.post(path + "/claim", json=versions(task)).json()["data"]
    with sessions.begin() as db:
        workflow = db.get(Workflow, workflow_id)
        if changed == "workflow":
            workflow.version += 1
        elif changed == "graph":
            workflow.graph_hash = "other-deployment"
        elif changed == "checkpoint":
            db.get(UploadInput, workflow_id).checkpoint_id = "other-checkpoint"
        else:
            workflow.inference_envelope_id = "other-envelope"
    assert client.post(path + "/submit", json={**versions(claimed), "decisionCode": "APPROVE_CONTINUE",
                                              "reasonCode": "QUALITY_APPROVED"}).status_code == 409


def test_owner_is_shown_doctor_decision_but_other_users_cannot_read_it(workflow_api):
    client, _, _, workflow_id = prepare(workflow_api)
    task = client.get("/api/reviews/tasks").json()["data"][0]
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    response = client.get(path + "/image")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-type"] == "image/png"
    assert "glaucoma" not in str(client.get(path).json())
    doctor(client, "bob")
    assert client.get(f"/api/diagnosis/workflows/{workflow_id}").status_code == 403
    doctor(client, "alice")
    assert query(client, workflow_id)["qualityReview"] == {
        "status": "OPEN", "decisionCode": None, "reasonCode": None}


def test_waiting_review_survives_new_app_and_separate_worker_process(workflow_api):
    from web.workflow.models import Job, ReviewTask, WorkflowEvent

    client, sessions, _, workflow_id = prepare(workflow_api)
    app = create_app(WebConfig())
    app.dependency_overrides[get_db] = client.app.dependency_overrides[get_db]
    app.state.java_client = httpx.AsyncClient(base_url="http://java/api/",
        transport=client.app.state.java_client._transport)
    restarted = TestClient(app)
    try:
        doctor(restarted)
        task = restarted.get("/api/reviews/tasks").json()["data"][0]
        path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
        claimed = restarted.post(path + "/claim", json=versions(task)).json()["data"]
        body = {**versions(claimed), "decisionCode": "REJECT_RESUBMIT", "reasonCode": "QUALITY_REJECTED"}
        assert restarted.post(path + "/submit", json=body).status_code == 200
        script = """
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from web.workflow.worker import Worker
engine = create_engine(sys.argv[1])
assert Worker(sessionmaker(engine, expire_on_commit=False)).run_once()
assert not Worker(sessionmaker(engine, expire_on_commit=False)).run_once()
engine.dispose()
"""
        result = subprocess.run([sys.executable, "-c", script, str(sessions.kw["bind"].url)],
            capture_output=True, text=True, timeout=30, cwd=Path(__file__).resolve().parents[2])
        assert result.returncode == 0, result.stderr
        assert restarted.post(path + "/submit", json=body).status_code == 200
        with sessions() as db:
            task = db.scalar(select(ReviewTask))
            assert task.submitted_doctor_id == 9
            jobs = list(db.scalars(select(Job).where(Job.workflow_id == workflow_id)))
            assert len(jobs) == 4 and all(job.status == "COMPLETED" for job in jobs)
            events = list(db.scalars(select(WorkflowEvent).where(WorkflowEvent.actor_type == "DOCTOR")
                                    .order_by(WorkflowEvent.sequence)))
            assert [(event.event_type, event.actor_id) for event in events] == [
                ("QUALITY_REVIEW_CLAIMED", "9"), ("QUALITY_REVIEW_SUBMITTED", "9")]
            assert all(task.task_id in event.payload for event in events)
        doctor(restarted, "alice")
        assert query(restarted, workflow_id)["status"] == "REJECTED"
    finally:
        restarted.close()
        asyncio.run(app.state.java_client.aclose())


def test_quality_approval_cannot_bypass_original_ood_abstention(workflow_api):
    client, sessions, engine, workflow_id = prepare(workflow_api, prediction(
        quality_reasons="blur", is_ood=True, rejected=True, abstain_reason="OOD"))
    task = client.get("/api/reviews/tasks").json()["data"][0]
    path = f'/api/reviews/tasks/{task["reviewTaskId"]}'
    claimed = client.post(path + "/claim", json=versions(task)).json()["data"]
    body = {**versions(claimed), "decisionCode": "APPROVE_CONTINUE", "reasonCode": "QUALITY_APPROVED"}
    assert client.post(path + "/submit", json=body).status_code == 200
    for _ in range(2):
        assert Worker(sessions).run_once()
    assert not Worker(sessions).run_once()
    doctor(client, "alice")
    view = query(client, workflow_id)
    assert (view["status"], view["stopReasonCode"]) == ("COMPLETED_LIMITED", "OOD")
    assert view["result"] is None and engine.calls == 1

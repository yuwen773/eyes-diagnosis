"""Issue18 recovery through authenticated HTTP/SSE, without replaying commands."""

import json

from web.tests.test_chat import chat_api, chat
from web.tests.test_chat_workflow import workflow_api, send
from web.tests.test_workflow import create_upload
from web.tests.test_controlled_evidence import evidence_api
from web.tests.test_validated_explanation import explanation_api


def snapshot(client, task):
    response = client.get(f"/api/diagnosis/workflows/{task}/events")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.text.endswith('event: done\ndata: ""\n\n')
    frame = response.text.split("\n\n")[0]
    assert frame.startswith("event: state\n")
    return json.loads(frame.split("data: ", 1)[1])


def test_reconnect_reads_latest_workflow_and_wait_without_replaying(workflow_api):
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    task = create_upload(client).json()["data"]["workflowId"]
    send(client, workflowId=task)
    first = snapshot(client, task)
    assert first["workflow"]["status"] == "QUEUED"
    assert first["supplements"] == [] and first["saveConfirmation"] is None
    client.post("/api/agent/chat/stream", json={"threadId": "shared", "message": "补充本次说明",
        "supplement": {"workflowId": task, "idempotencyKey": "wait"}})
    wait = snapshot(client, task)["supplements"][0]
    assert wait["sessionId"] == "shared" and wait["workflowId"] == task
    assert wait["status"] == "WAITING"
    worker = Worker(sessions)
    while worker.run_once():
        pass
    latest = snapshot(client, task)
    assert latest["workflow"]["status"] == "FAILED"
    assert latest["workflow"]["result"] is None
    history = client.get("/api/agent/history/shared").json()
    for _ in range(3):
        assert snapshot(client, task) == latest
    assert client.get("/api/agent/history/shared").json() == history
    assert not worker.run_once()
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


def test_event_snapshot_requires_current_identity_and_task_ownership(workflow_api):
    client, _ = workflow_api
    task = create_upload(client).json()["data"]["workflowId"]
    snapshot(client, task)
    client.cookies.set("SESSION", "bob")
    response = client.get(f"/api/diagnosis/workflows/{task}/events")
    assert response.status_code == 403 and "text/event-stream" not in response.headers["content-type"]
    client.cookies.clear()
    assert client.get(f"/api/diagnosis/workflows/{task}/events").status_code == 401


def test_chat_tokens_correlate_with_persisted_execution_and_keep_done_contract(chat_api):
    build, calls = chat_api
    client = build()
    response = chat(client, "correlated", "普通聊天")
    frames = response.text.split("\n\n")
    delta = json.loads(next(frame[6:] for frame in frames if frame.startswith("data: {")))
    history = client.get("/api/agent/history/correlated").json()["data"]
    assert delta["sessionId"] == "correlated"
    assert delta["runId"] == history["executions"][0]["id"]
    assert "event: done" in response.text and "event: error" not in response.text
    assert len(calls) == 1


def test_recovery_separates_clinical_completion_consent_and_saved_receipt(explanation_api):
    from web.tests.test_save_confirmation import prepare, act

    client, _, task, view, pending = prepare(explanation_api)
    state = snapshot(client, task)
    assert state["workflow"] == view and state["workflow"]["status"] == "COMPLETED"
    assert state["saveConfirmation"] == pending
    assert pending["status"] == "PENDING"
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
    approved = act(client, pending).json()["data"]
    for _ in range(3):
        assert snapshot(client, task)["saveConfirmation"] == approved
    assert approved["status"] == "APPROVED"
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "1"

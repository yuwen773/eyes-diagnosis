"""Ticket 04: legacy HTTP -> explicit rebuild -> independent Worker seams."""

from datetime import datetime

import pytest
from sqlalchemy import text

from web.tests.test_workflow import workflow_api, create_upload, picture_bytes
from web.workflow.models import Workflow, Job
from web.tests.test_human_wait_restart import restart_case


@pytest.fixture
def legacy_api(workflow_api):
    client, sessions = workflow_api
    with sessions.begin() as db:
        db.add(Workflow(workflow_id="java-wait", owner_user_id=7, idempotency_key="java-key",
                        status="WAITING_HUMAN_REVIEW", graph_version="java-release",
                        graph_hash="old-hash", action_version="old-action",
                        created_at=datetime(2025, 1, 2, 3, 4, 5),
                        question=None, segment=None))
        db.add(Job(job_id="java-job", workflow_id="java-wait", job_type="RESUME",
                   segment_code="java-segment", checkpoint_id="java-opaque-checkpoint"))
    yield client, sessions


def test_old_workflow_can_be_listed_viewed_and_refreshed_without_python_input(legacy_api):
    client, sessions = legacy_api
    current = create_upload(client).json()["data"]["workflowId"]
    with sessions.begin() as db:
        db.get(Workflow, current).graph_version = "previous-python-deployment"
    response = client.get("/api/diagnosis/legacy-tasks")
    assert response.status_code == 200
    records = response.json()["data"]["records"]
    assert [row["taskId"] for row in records] == ["java-wait"]
    assert current not in [row["taskId"] for row in records]
    for _ in range(2):
        detail = client.get("/api/diagnosis/legacy-tasks/workflow/java-wait")
        assert detail.status_code == 200
        view = detail.json()["data"]
        assert view["status"] == "WAITING_HUMAN_REVIEW"
        assert view["createdAt"] == "2025-01-02T03:04:05"
        assert view["sourceType"] == "workflow"
        assert view["requiresUpload"] is True
        assert "checkpoint" not in str(view).lower()
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


def test_v3_upload_shape_is_read_only_and_owner_scoped(legacy_api):
    client, sessions = legacy_api
    with sessions.begin() as db:
        db.execute(text("DROP TABLE t_upload_task"))
        db.execute(text("CREATE TABLE t_upload_task (id INTEGER PRIMARY KEY, "
                        "taskId VARCHAR(64), userId BIGINT, objectKey VARCHAR(512), status INTEGER, "
                        "retryCount INTEGER, lastError VARCHAR(512), createTime DATETIME, updateTime DATETIME)"))
        db.execute(text("INSERT INTO t_upload_task (id,taskId,userId,objectKey,status,retryCount) "
                        "VALUES (1,'old-upload',7,'missing-private-object',0,2),"
                        "(2,'missing-owner',NULL,'private',0,0)"))
    response = client.get("/api/diagnosis/legacy-tasks/upload/old-upload")
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "0"
    assert response.json()["data"]["createdAt"] is None
    assert "private" not in response.text
    assert client.get("/api/diagnosis/legacy-tasks/upload/missing-owner").status_code == 403
    assert client.get("/api/diagnosis/legacy-tasks").json()["data"]["total"] == 2
    for identity in ("bob", "doctor", "admin"):
        client.cookies.set("EYE_SESSION", identity)
        assert client.get("/api/diagnosis/legacy-tasks").json()["data"]["records"] == []
        for source, task in (("workflow", "java-wait"), ("upload", "old-upload")):
            assert client.get(f"/api/diagnosis/legacy-tasks/{source}/{task}").status_code == 403
    client.cookies.clear()
    assert client.get("/api/diagnosis/legacy-tasks").status_code == 401
    assert client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").status_code == 401


def rebuild(client, task="java-wait", key="rebuild-one", confirmed="true", content=None):
    return client.post(f"/api/diagnosis/legacy-tasks/workflow/{task}/rebuild",
                       data={"idempotencyKey": key, "confirmed": confirmed},
                       files={"file": ("new.png", content or picture_bytes(), "image/png")})


def test_confirmed_rebuild_is_durable_idempotent_and_starts_independent_worker(legacy_api):
    from web.workflow.worker import Worker

    client, sessions = legacy_api
    original = client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").json()["data"]
    response = rebuild(client)
    assert response.status_code == 202
    new = response.json()["data"]
    assert new["workflowId"] != "java-wait"
    assert new["status"] == "QUEUED"
    assert new["progress"]["completed"] == []
    assert new["qualityReview"] is None and new["finalReview"] is None and new["result"] is None
    assert new["legacySource"] == {
        "taskId": "java-wait", "sourceType": "workflow", "createdAt": "2025-01-02T03:04:05",
        "status": "WAITING_HUMAN_REVIEW", "sourceVersion": "java-release",
        "confirmedBy": "7", "confirmedAt": new["legacySource"]["confirmedAt"],
    }
    assert new["legacySource"]["confirmedAt"]
    assert rebuild(client).json()["data"] == new
    assert client.get(f"/api/diagnosis/workflows/{new['workflowId']}").json()["data"] == new
    events = client.get(f"/api/diagnosis/workflows/{new['workflowId']}/events")
    assert events.status_code == 200
    assert '"createdAt": "2025-01-02T03:04:05"' in events.text
    assert "event: done" in events.text
    assert Worker(sessions).run_once()
    view = client.get(f"/api/diagnosis/workflows/{new['workflowId']}").json()["data"]
    assert view["progress"]["completed"] == ["validateImage"]
    assert rebuild(client).json()["data"]["workflowId"] == new["workflowId"]
    assert Worker(sessions).run_once()
    assert not Worker(sessions).run_once()
    assert client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").json()["data"] == original
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


def test_rebuild_requires_confirmation_new_input_and_owner_and_binds_retry_content(legacy_api):
    client, _ = legacy_api
    assert rebuild(client, confirmed="false").status_code == 400
    assert client.post("/api/diagnosis/legacy-tasks/workflow/java-wait/rebuild",
                       data={"idempotencyKey": "no-input", "confirmed": "true"}).status_code == 422
    assert rebuild(client, task="missing").status_code == 404
    current = create_upload(client).json()["data"]["workflowId"]
    assert rebuild(client, task=current).status_code == 404
    assert rebuild(client).status_code == 202
    assert rebuild(client, content=b"changed").status_code == 409
    for identity in ("bob", "admin", "doctor"):
        client.cookies.set("EYE_SESSION", identity)
        assert rebuild(client).status_code == 403
    client.cookies.clear()
    assert rebuild(client).status_code == 401


def test_current_workflow_endpoints_do_not_execute_or_mutate_legacy_tasks(legacy_api):
    client, _ = legacy_api
    for suffix in ("", "/events", "/image", "/save-confirmation"):
        assert client.get("/api/diagnosis/workflows/java-wait" + suffix).status_code == 409


def test_same_key_cannot_rebuild_another_source_and_upload_tasks_can_rebuild(legacy_api):
    from web.chat.models import LegacyUpload

    client, sessions = legacy_api
    with sessions.begin() as db:
        db.add(LegacyUpload(id=1, task_id="old-upload", user_id=7, object_key="missing", status=0))
    first = rebuild(client).json()["data"]["workflowId"]
    url = "/api/diagnosis/legacy-tasks/upload/old-upload/rebuild"
    def upload_rebuild(key):
        return client.post(url, data={"confirmed": "true", "idempotencyKey": key},
                           files={"file": ("new.png", picture_bytes(), "image/png")})
    assert upload_rebuild("rebuild-one").status_code == 409
    response = upload_rebuild("different-key")
    assert response.status_code == 202
    assert response.json()["data"]["workflowId"] != first
    assert response.json()["data"]["legacySource"]["sourceType"] == "upload"


def test_rebuild_survives_api_restart_and_requires_fresh_doctor_and_user_approvals(restart_case):
    from web.workflow.models import ReviewTask
    from web.workflow.confirmation_models import SaveConfirmation
    from web.tests.test_quality_review import versions
    from web.tests.test_save_confirmation import path, requested, act

    case = restart_case
    with case.sessions.begin() as db:
        db.add(Workflow(workflow_id="java-wait", owner_user_id=7, idempotency_key="java-key",
                        status="WAITING_HUMAN_REVIEW", graph_version="java-release",
                        graph_hash="old-hash", action_version="old-action"))
        db.add(Job(job_id="old-job", workflow_id="java-wait", job_type="RESUME",
                   segment_code="java-segment", checkpoint_id="opaque-java-checkpoint"))
        db.add(ReviewTask(task_id="old-review", workflow_id="java-wait", review_type="IMAGE_QUALITY_GATE",
                          status="SUBMITTED", decision="APPROVE_CONTINUE", submitted_doctor_id=10,
                          workflow_version=0, envelope_id="old-envelope", graph_version="java-release",
                          graph_hash="old-hash", action_version="old-action",
                          thread_id="old-thread", checkpoint_id="opaque-java-checkpoint"))
        db.add(SaveConfirmation(confirmation_id="old-consent", workflow_id="java-wait", owner_user_id=7,
                               operation="SAVE_DIAGNOSIS", idempotency_key="old-consent", workflow_version=0,
                               request_version=1, status="APPROVED", content='{"legacy":true}',
                               content_digest="a" * 64, created_at=datetime(2025, 1, 2),
                               expires_at=datetime(2030, 1, 2), decided_at=datetime(2025, 1, 3)))
    with case.api() as client:
        original = client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").json()["data"]
        created = rebuild(client).json()["data"]
        task = created["workflowId"]
    with case.api() as client:
        assert rebuild(client).json()["data"] == created
        case.worker("quality")
        status = client.get(f"/api/diagnosis/workflows/{task}").json()["data"]
        assert status["status"] == "WAITING_HUMAN_REVIEW"
        assert status["qualityReview"]["status"] == "OPEN"
        assert client.get(path(task)).json()["data"] is None
        client.cookies.set("EYE_SESSION", "doctor")
        review = next(row for row in client.get("/api/reviews/tasks").json()["data"] if row["workflowId"] == task)
        review_path = f"/api/reviews/tasks/{review['reviewTaskId']}"
        assert client.post(review_path + "/claim", json=versions(review)).status_code == 200
        claimed = client.get(review_path).json()["data"]
        assert client.post(review_path + "/submit", json={**versions(claimed),
            "decisionCode": "APPROVE_CONTINUE", "reasonCode": "QUALITY_APPROVED"}).status_code == 200
        case.worker("pass")
        client.cookies.set("EYE_SESSION", "alice")
        assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
        status = client.get(f"/api/diagnosis/workflows/{task}").json()["data"]
        assert status["status"] == "COMPLETED"
        consent = client.post(path(task), json=requested(status)).json()["data"]
        assert consent["status"] == "PENDING"
        assert consent["confirmationId"] != "old-consent"
        assert act(client, consent).json()["data"]["status"] == "APPROVED"
        assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "1"
        assert client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").json()["data"] == original
    with case.sessions() as db:
        assert db.get(ReviewTask, "old-review").decision == "APPROVE_CONTINUE"
        assert db.get(SaveConfirmation, "old-consent").status == "APPROVED"
        assert db.get(Job, "old-job").status == "READY"

"""V22 -> Python handoff while genuine persisted human waits exist.

Production API/Worker processes and real isolated MySQL; external identity,
inference and evidence are synthetic. This is not model/clinical acceptance.
"""

import json
import os
from dataclasses import dataclass, field

import pytest

from web.migrations.baseline import ASSETS
from web.migrations.runner import connect, data_snapshot, query
from web.tests.handoff_fixtures import isolated_database, legacy_database
from web.tests.test_database_handoff import cli, isolated_env
from web.tests.test_human_wait_restart import restart_case, start, view  # noqa: F401
from web.tests.test_quality_review import versions
from web.tests.test_final_clinical_review import final_versions
from web.tests.test_save_confirmation import path, requested, act
from web.tests.test_supplement import request_supplement, supplement_event, reply
from web.tests.test_chat_workflow import send


@dataclass
class HandoffCase:
    case: object = field(repr=False)
    url: str = field(repr=False)

    def __iter__(self):
        yield self.case
        yield self.url


@pytest.fixture
def handoff_case(monkeypatch, request):
    admin = os.getenv("HANDOFF_TEST_MYSQL_ADMIN_URL")
    if not admin:
        pytest.skip("Opt-in isolated real MySQL handoff/restart acceptance")
    url, _ = isolated_database(admin, prefix="eye_human_wait_issue17_")
    legacy_database(url, 22)
    monkeypatch.setenv("HUMAN_WAIT_TEST_MYSQL_URL", url)
    # Use the established public HTTP/child-process fixture after preparing V22.
    case = request.getfixturevalue("restart_case")
    case.env = isolated_env(**{key: value for key, value in case.env.items() if key.startswith("HUMAN_WAIT_")})
    with connect(url) as db:
        with db.cursor() as cursor:
            cursor.execute("INSERT INTO t_user (id,userAccount,userPassword,userRole) VALUES "
                           "(7,'synthetic-alice','opaque-a','user'),(8,'synthetic-bob','opaque-b','user'),"
                           "(10,'synthetic-doctor','opaque-c','doctor')")
            cursor.execute("INSERT INTO t_upload_task (id,taskId,userId,objectKey,status) "
                           "VALUES (9007199254740997,'synthetic-java-task',8,'legacy/image.png',1)")
            cursor.execute("INSERT INTO t_diagnosis (id,url,userId,result,humanReviewStatus) VALUES "
                           "(9007199254740995,'https://fixture.invalid/traditional.png',7,'synthetic-ai','AI_ONLY')")
            cursor.execute("INSERT INTO t_agent_session (id,sessionId,userId,title,checkpointData) VALUES "
                           "(9007199254740999,'synthetic-java-history',8,'Synthetic legacy history',%s)",
                           (b"\xac\xed\x00\x05SYNTHETIC-LEGACY-CHECKPOINT",))
        db.commit()
    return HandoffCase(case, url)


@pytest.mark.parametrize("kind", ["quality", "final", "save", "supplement"])
def test_four_human_waits_resume_after_database_handoff(handoff_case, kind):
    case, url = handoff_case
    with case.api() as client:
        workflow_id = start(client)
        case.worker(kind if kind in {"quality", "final"} else "pass")
        before = view(client, workflow_id)
        if kind in {"quality", "final"}:
            client.cookies.set("SESSION", "doctor")
            task = next(row for row in client.get("/api/reviews/tasks").json()["data"]
                        if row["workflowId"] == workflow_id)
            wait_url = f"/api/reviews/tasks/{task['reviewTaskId']}"
            wait = client.get(wait_url).json()["data"]
        elif kind == "save":
            wait_url = path(workflow_id)
            wait = client.post(wait_url, json=requested(before, "handoff-save")).json()["data"]
            assert wait["status"] == "PENDING"
        else:
            assert "event: done" in send(client, thread="handoff-chat", workflowId=workflow_id).text
            wait = supplement_event(request_supplement(client, workflow_id, thread="handoff-chat"))
            wait_url = f"/api/agent/supplements/{wait['requestId']}"
        effects = case.effects(workflow_id)
    with connect(url) as db:
        original = data_snapshot(db)
        assert original["t_python_graph_checkpoint"]["count"] > 0
        assert original["t_python_graph_write"]["count"] > 0
    env = isolated_env(**case.env, MIGRATION_MYSQL_URL=url)
    result = cli("upgrade", env=env)
    assert result.returncode == 0, result.stdout
    with connect(url) as db:
        assert data_snapshot(db, original) == original
        assert query(db, "SELECT status FROM t_upload_task WHERE taskId='synthetic-java-task'") == [{"status": 1}]
    with case.api("doctor" if kind in {"quality", "final"} else "alice") as client:
        assert client.get(wait_url).json()["data"] == wait
        assert case.effects(workflow_id) == effects
        if kind in {"quality", "final"}:
            body = versions(wait) if kind == "quality" else final_versions(wait)
            assert client.post(wait_url + "/claim", json=body).status_code == 200
            claimed = client.get(wait_url).json()["data"]
            payload = {**(versions(claimed) if kind == "quality" else final_versions(claimed)),
                       "decisionCode": "APPROVE_CONTINUE" if kind == "quality" else "CONFIRM_AI_ASSESSMENT",
                       "reasonCode": "QUALITY_APPROVED" if kind == "quality" else "AI_ASSESSMENT_CONFIRMED"}
            response = client.post(wait_url + "/submit", json=payload)
            assert response.status_code == 200, response.text
            case.worker()
            assert not case.effects(workflow_id)["receipts"]
        elif kind == "save":
            response = act(client, wait)
            assert response.status_code == 200, response.text
            assert act(client, wait).json() == response.json()
            assert len(case.effects(workflow_id)["receipts"]) == 1
        else:
            response = reply(client, wait)
            assert response.status_code == 200, response.text
            assert reply(client, wait).json() == response.json()
            assert view(client, workflow_id) == before
            assert not case.effects(workflow_id)["receipts"]
    assert case.calls().count("inference") == 1
    assert cli("upgrade", env=env).returncode == 0


def test_recovery_export_and_action_tokens_match_frozen_baseline():
    from web.migrations.baseline import recovery_differences

    assert recovery_differences(ASSETS) == []
    sample = json.loads((ASSETS / "recovery-samples.json").read_text())
    assert sample["chatSupplementGraph"]["version"] == "chat-supplement-v1"

"""Opt-in isolated MySQL: TCP retries/restart and the production Worker."""

import os
from concurrent.futures import ThreadPoolExecutor

import pytest

from web.tests.handoff_fixtures import isolated_database, legacy_database
from web.tests.test_database_handoff import cli, isolated_env
from web.tests.test_human_wait_restart import restart_case
from web.tests.test_legacy_workflow import rebuild
from web.workflow.models import Workflow, Job


@pytest.fixture
def legacy_mysql_case(monkeypatch, request):
    admin = os.environ.get("HANDOFF_TEST_MYSQL_ADMIN_URL")
    if not admin:
        pytest.skip("Opt-in isolated local MySQL legacy acceptance")
    url, _ = isolated_database(admin, prefix="eye_human_wait_issue17_")
    legacy_database(url, 22)
    result = cli("upgrade", env=isolated_env(MIGRATION_MYSQL_URL=url))
    assert result.returncode == 0, result.stdout
    monkeypatch.setenv("HUMAN_WAIT_TEST_MYSQL_URL", url)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    return request.getfixturevalue("restart_case")


def test_real_mysql_concurrent_rebuild_retries_commit_one_job_and_survive_restart(legacy_mysql_case):
    case = legacy_mysql_case
    with case.sessions.begin() as db:
        db.add(Workflow(workflow_id="java-wait", owner_user_id=7, idempotency_key="java-key",
                        status="WAITING_HUMAN_REVIEW", graph_version="java-release",
                        graph_hash="old-hash", action_version="old-action"))
        db.add(Job(job_id="old-job", workflow_id="java-wait", job_type="RESUME", segment_code="java"))
    with case.api() as client:
        original = client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").json()["data"]
        with ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(lambda _: rebuild(client), range(6)))
        assert [response.status_code for response in responses] == [202] * 6
        ids = {response.json()["data"]["workflowId"] for response in responses}
        assert len(ids) == 1
        workflow_id = ids.pop()
    with case.api() as client:
        assert rebuild(client).json()["data"]["workflowId"] == workflow_id
        case.worker("quality")
        assert client.get(f"/api/diagnosis/workflows/{workflow_id}").json()["data"]["qualityReview"]["status"] == "OPEN"
        assert client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").json()["data"] == original
        assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
    effects = case.effects(workflow_id)
    assert len(effects["inference"]) == 1
    assert len(effects["reviews"]) == 1
    assert not effects["confirmations"] and not effects["receipts"]
    assert case.calls().count("inference") == 1
    with case.sessions() as db:
        jobs = db.query(Job).filter(Job.workflow_id == workflow_id, Job.job_type == "START").all()
        assert len(jobs) == 1
        assert db.get(Job, "old-job").status == "READY"

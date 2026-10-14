"""Task HTTP/Worker seam: provider faults retry, invalid drafts stay withheld."""

from datetime import datetime
from itertools import cycle
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from web.tests.test_controlled_evidence import evidence_api
from web.tests.test_validated_explanation import explanation_api, drain, read, start
from web.workflow.models import Job, ReviewTask


@pytest.mark.parametrize("fault", ["timeout", "connect", "rate_limit", "server", "deadline"])
def test_explanation_provider_faults_exhaust_as_failed(explanation_api, fault, monkeypatch, caplog):
    client, sessions, _, model = explanation_api
    if fault == "deadline":
        from web.workflow import explanation

        clock = cycle((0, 16))
        monkeypatch.setattr(explanation, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    if fault in {"timeout", "connect"}:
        def fail():
            error = httpx.ReadTimeout if fault == "timeout" else httpx.ConnectError
            raise error("private provider failure")

        model["before_response"] = fail
    elif fault != "deadline":
        model["response"] = httpx.Response(429 if fault == "rate_limit" else 503)
    task = start(client)
    for expected in ("QUEUED", "QUEUED", "FAILED"):
        if fault in {"timeout", "connect"}:
            model["before_response"] = fail
        drain(sessions)
        view = read(client, task)
        assert view["status"] == expected
        assert view["result"] is None and view["explanation"]["publicationStatus"] == "NONE"
        assert "private" not in str(view)
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == task, Job.status == "RETRY_WAIT"))
            if job:
                job.available_at = datetime(2000, 1, 1)
    assert view["stopReasonCode"] == "EXECUTION_FAILED"
    assert len(model["requests"]) == 3
    assert "private provider failure" not in caplog.text
    with sessions() as db:
        assert db.scalar(select(ReviewTask).where(ReviewTask.workflow_id == task)) is None

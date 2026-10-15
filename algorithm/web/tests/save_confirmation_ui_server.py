"""Loopback-only issue11 fixture. SQLite and synthetic services, never deploy."""

import asyncio
from datetime import timedelta

import pytest
import uvicorn
from sqlalchemy import func, select

from web.models.diagnosis import Diagnosis
from web.tests.test_controlled_evidence import evidence_api
from web.tests.test_validated_explanation import explanation_api, drain
from web.workflow.confirmation_models import SaveConfirmation


def main():
    patch = pytest.MonkeyPatch()
    fixture = evidence_api.__wrapped__(patch)
    evidence = next(fixture)
    client, sessions, *_ = explanation_api.__wrapped__(evidence)
    app = client.app
    app.state.clinical = False

    @app.post("/__fixture/clinical/{enabled}")
    def clinical(enabled: bool):
        app.state.clinical = enabled
        return {"clinical": enabled}

    @app.post("/__fixture/expire/{confirmation_id}")
    def expire(confirmation_id: str):
        with sessions.begin() as db:
            db.get(SaveConfirmation, confirmation_id).expires_at -= timedelta(hours=1)
        return {"expired": True}

    @app.get("/__fixture/count")
    def count():
        with sessions() as db:
            return {"formalRecords": db.scalar(select(func.count()).select_from(Diagnosis))}

    async def fixture_app(scope, receive, send):
        await app(scope, receive, send)
        if (scope["type"] == "http" and scope["method"] == "POST"
                and scope["path"] == "/api/diagnosis/workflows"):
            await asyncio.to_thread(drain, sessions, requires_review=app.state.clinical)

    try:
        uvicorn.run(fixture_app, host="127.0.0.1", port=15281, lifespan="off")
    finally:
        try:
            next(fixture)
        except StopIteration:
            pass
        patch.undo()


if __name__ == "__main__":
    main()

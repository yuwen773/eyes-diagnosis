"""Governance must be visible to independent HTTP reads at response delivery."""
import asyncio
from datetime import datetime

import httpx
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from web import database
from web.app import create_app
from web.config import WebConfig
from web.db import Base
from web.models.knowledge import KnowledgeDocument
from web.tests.session_fixtures import SESSION_COOKIE_NAME, install_sessions


@pytest.fixture
def governance_app(tmp_path, monkeypatch):
    app = create_app(WebConfig())
    engine = create_engine(f"sqlite:///{tmp_path / 'knowledge.db'}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    # Use the production dependency, including its actual transaction cleanup.
    monkeypatch.setattr(database, "get_session_factory", lambda: sessions)
    install_sessions(app, engine)
    with sessions.begin() as db:
        db.add(KnowledgeDocument(id=1, user_id=7, title="Controlled reference",
            file_name="reference.txt", file_url="https://fixture.invalid/reference.txt",
            file_type="txt", status=1, chunk_count=1, visibility="PRIVATE_USER",
            review_status="PENDING", disease_codes=[], topic_codes=[], governance_version=0,
            create_time=datetime.now(), update_time=datetime.now(), is_delete=0))
    yield app, sessions
    engine.dispose()


def test_approval_is_visible_to_independent_read_when_success_body_is_sent(governance_app):
    app, _ = governance_app
    observed = []

    async def exercise():
        headers = {"cookie": f"{SESSION_COOKIE_NAME}=admin"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://test", headers=headers) as reader:
            async def at_delivery(scope, receive, send):
                async def delivered(message):
                    await send(message)
                    if message["type"] == "http.response.body" and not message.get("more_body", False):
                        # ASGI sends the complete response before dependency teardown.
                        # A new request here models a client reading immediately.
                        response = await reader.post("/api/knowledge/admin/documents", json={})
                        assert response.status_code == 200
                        observed.extend(response.json()["data"]["records"])
                await app(scope, receive, delivered)

            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=at_delivery),
                                         base_url="http://test", headers=headers) as writer:
                response = await writer.patch("/api/knowledge/admin/documents/1", json={
                    "visibility": "CURATED_PUBLIC", "reviewStatus": "APPROVED",
                    "diseaseCodes": ["myopia"], "topicCodes": ["DISEASE_OVERVIEW"],
                    "expectedVersion": 0, "confirmed": True})
                assert response.status_code == 200
                assert response.json()["code"] == 0
                assert response.json()["data"]["governanceVersion"] == 1

    asyncio.run(exercise())
    assert len(observed) == 1
    assert (observed[0]["governanceVersion"], observed[0]["reviewStatus"],
            observed[0]["visibility"], observed[0]["diseaseCodes"]) == (
                1, "APPROVED", "CURATED_PUBLIC", ["myopia"])


def test_failed_approval_commit_returns_error_and_can_be_retried(governance_app):
    app, sessions = governance_app

    def fail_commit(db):
        raise OperationalError("COMMIT", {}, RuntimeError("controlled commit failure"))

    event.listen(sessions, "before_commit", fail_commit, once=True)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://test", headers={"cookie": f"{SESSION_COOKIE_NAME}=admin"}) as client:
            body = {"visibility": "CURATED_PUBLIC", "reviewStatus": "APPROVED",
                    "diseaseCodes": ["myopia"], "topicCodes": ["DISEASE_OVERVIEW"],
                    "expectedVersion": 0, "confirmed": True}
            response = await client.patch("/api/knowledge/admin/documents/1", json=body)
            assert response.status_code == 500
            assert response.json()["code"] == 50000 and response.json()["data"] is None
            row = (await client.post("/api/knowledge/admin/documents", json={})).json()["data"]["records"][0]
            assert (row["governanceVersion"], row["reviewStatus"]) == (0, "PENDING")
            retry = await client.patch("/api/knowledge/admin/documents/1", json=body)
            assert retry.status_code == 200
            assert retry.json()["data"]["governanceVersion"] == 1
            stale = await client.patch("/api/knowledge/admin/documents/1", json=body)
            assert stale.status_code == 409

    asyncio.run(exercise())

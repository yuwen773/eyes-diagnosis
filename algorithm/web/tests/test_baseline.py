"""HTTP compatibility of the endpoints Python now owns, including the session.

These are ASGI tests with SQLite and an in-memory Redis, not live Java, Redis,
COS or model acceptance.

Before ticket 02 this file asserted that a *Java* session cookie authorized a
Python business query. That guarantee is gone -- Python issues and validates its
own session -- so the two session-shaped tests here are rewritten around the new
authority: a Spring cookie grants nothing, and a session revoked on the server
stops working on the very next request. Everything about the error envelope is
unchanged.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.app import create_app
from web.config import WebConfig
from web.db import Base
from web.deps import get_db
from web.models.user import User
from web.tests.session_fixtures import SESSION_COOKIE_NAME, install_sessions


@pytest.fixture
def bridge():
    """An app with a seeded ``t_user``, a session store, and a row editor."""
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    app = create_app(WebConfig())

    def database():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = database
    sessions = install_sessions(app, engine)

    def edit_user(user_id: int, **changes):
        """Change a row behind the app's back, as an operator or a concurrent
        request would. The session has to notice on the next call."""
        with Session(engine) as db:
            db.execute(update(User).where(User.id == user_id).values(**changes))
            db.commit()

    client = TestClient(app, raise_server_exceptions=False)
    yield client, sessions, edit_user
    client.close()
    engine.dispose()


def test_a_python_session_cookie_authorizes_a_business_query(bridge):
    client, sessions, _ = bridge
    sessions.authenticate(client, "admin")
    response = client.post("/api/user/list/page/vo", json={})
    assert response.status_code == 200
    assert response.json()["code"] == 0


def test_a_spring_cookie_authorizes_nothing(bridge):
    """The old session authority must not confer login eligibility here."""
    client, _, _ = bridge
    for name in ("SESSION", "JSESSIONID"):
        client.cookies.set(name, "baseline-session")
        response = client.post("/api/user/list/page/vo", json={})
        assert response.status_code == 200
        assert response.json()["code"] == 40100


def test_revoking_the_session_stops_the_next_request_even_with_the_old_cookie(bridge):
    client, sessions, _ = bridge
    sessions.authenticate(client, "admin")
    stale = client.cookies.get(SESSION_COOKIE_NAME)
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 0

    sessions.store.expire_now(sessions.key(stale))

    response = client.post("/api/user/list/page/vo", json={})
    assert response.status_code == 200
    assert response.json()["code"] == 40100


def test_missing_weights_reject_sync_diagnosis_without_creating_a_record(bridge):
    from web.inference import InferenceEngine, InferenceUnavailable

    client, sessions, _ = bridge
    sessions.authenticate(client, "alice")
    engine = InferenceEngine(WebConfig(model_weights_path=""))
    with pytest.raises(InferenceUnavailable, match="MODEL_WEIGHTS_PATH"):
        engine.load()
    client.app.state.inference_engine = engine
    response = client.post("/api/diagnosis/diagnosis", files={
        "file": ("fundus.png", b"image-input", "image/png")
    })
    assert response.status_code == 200
    assert response.json() == {"code": 50000, "msg": "系统错误", "data": None}
    page = client.post("/api/diagnosis/list/page/my", json={}).json()
    assert page["code"] == 0
    assert page["data"]["total"] == "0"


def test_session_cookie_is_not_shared_between_callers(bridge):
    client, sessions, _ = bridge
    sessions.authenticate(client, "admin")
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 0
    client.cookies.set(SESSION_COOKIE_NAME, "another-session")
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40100


def test_regular_user_can_query_history_but_cannot_list_users(bridge):
    client, sessions, _ = bridge
    sessions.authenticate(client, "alice")
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["code"] == 0
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40101


def test_promoting_a_user_takes_effect_on_their_live_session(bridge):
    """No re-login needed: the row is re-read per request, as in Java."""
    client, sessions, edit_user = bridge
    sessions.authenticate(client, "alice")
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40101

    edit_user(7, user_role="admin")

    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 0
    assert client.get("/api/user/get/login").json()["data"]["userRole"] == "admin"


def test_deleting_an_account_ends_its_live_session(bridge):
    client, sessions, edit_user = bridge
    sessions.authenticate(client, "alice")
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["code"] == 0

    edit_user(7, is_delete=1)

    assert client.post("/api/diagnosis/list/page/my", json={}).json()["code"] == 40100


@pytest.mark.parametrize("role", ["user", "unknown"])
def test_browser_cannot_override_the_required_admin_role(bridge, role):
    client, sessions, _ = bridge
    sessions.authenticate(client, "alice")
    response = client.post("/api/user/list/page/vo", params={"must_role": role}, json={})
    assert response.json()["code"] == 40101


def test_an_unreachable_session_authority_is_a_server_error_not_a_pass(bridge):
    """Fails closed. ``40100`` would send the frontend to the login page, and
    ``0`` would hand out another user's data."""
    client, sessions, _ = bridge
    sessions.authenticate(client, "admin")
    sessions.store.offline = True

    body = client.post("/api/user/list/page/vo", json={}).json()
    assert body["code"] == 50000
    assert body["data"] is None

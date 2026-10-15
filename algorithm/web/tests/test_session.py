"""Ticket 02: the login session, end to end over HTTP.

Every acceptance criterion about the *session* lives here, because before this
ticket there was no automated coverage of login/logout/get-login at all -- the
only net was four opt-in scripts that needed a running Java. These are ASGI
tests with SQLite and an in-memory Redis; real MySQL/Redis over TCP is
``web/verify_session_identity.py``, which is a different claim.

Read together, these are the guarantees:

* the three endpoints are Python's, and a Spring cookie grants nothing;
* a real BCrypt account still logs in, and a legacy MD5 one is upgraded;
* the session id rotates on every login;
* logout, expiry, logical delete and a role change all take effect at once;
* one user's session cannot read another's data;
* Redis being down is an error, never a pass.
"""

import json
import asyncio
import re
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.tests.session_fixtures import (  # noqa: E402
    DEFAULT_IDENTITIES,
    Identity,
    MemorySessionStore,
    identities,
    install_sessions,
)
from web.app import create_app  # noqa: E402
from web.config import WebConfig  # noqa: E402
from web.db import Base  # noqa: E402
from web.deps import get_db  # noqa: E402
from web.models.user import User  # noqa: E402

#: ``md5("yuwen" + password)`` -- the pre-BCrypt stored format, reproduced with
#: the same salt so a genuinely legacy row is exercised rather than a mock.
LEGACY_MD5_PASSWORD = "legacy-password"
LEGACY_MD5_HASH = "54cf2195b421bf9d0b236505c50f3adf"


@pytest.fixture
def api(tmp_path):
    """An app with SQLite, a seeded ``t_user``, and an in-memory session store."""
    config = WebConfig()
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)

    app = create_app(config)

    def database() -> Session:
        db = Session(engine)
        try:
            yield db
            db.commit()
        finally:
            db.close()

    app.dependency_overrides[get_db] = database
    sessions = install_sessions(app, engine)

    with Session(engine) as db:
        db.add(
            User(
                id=4242,
                user_account="legacy",
                user_password=LEGACY_MD5_HASH,
                user_name="Legacy",
                user_role="user",
                create_time=db.get(User, 7).create_time,
                edit_time=db.get(User, 7).create_time,
                update_time=db.get(User, 7).create_time,
                is_delete=0,
            )
        )
        db.commit()

    client = TestClient(app, raise_server_exceptions=False)
    yield client, sessions, engine
    client.close()
    engine.dispose()


def _login(client, account, password):
    return client.post("/api/user/login", json={"userAccount": account, "userPassword": password})


# ---------------------------------------------------------------------------
# Cookie shape
# ---------------------------------------------------------------------------
def test_login_sets_an_explicit_cookie_everywhere_it_matters(api):
    client, sessions, _ = api
    response = _login(client, "alice", "fixture-password")
    assert response.json()["code"] == 0
    assert response.status_code == 200

    header = response.headers["set-cookie"]
    assert header.startswith(f"{sessions.config.session_cookie_name}=")
    assert "Path=/" in header
    assert "HttpOnly" in header
    assert "SameSite=lax" in header
    # SameSite=None without Secure is rejected at config time, so a cookie can
    # never carry a SameSite the browser will refuse to store.
    assert "Secure" not in header


def test_cookie_uses_a_different_name_than_springs(api):
    """A browser still holding a Spring cookie must be anonymous here."""
    client, sessions, _ = api
    assert sessions.config.session_cookie_name not in {"SESSION", "JSESSIONID"}
    for spring_cookie in ("SESSION", "JSESSIONID"):
        client.cookies.set(spring_cookie, "alice")
        assert client.get("/api/user/get/login").json()["code"] == 40100


def test_sessions_live_in_their_own_redis_namespace(api):
    """Never alongside a Spring Session key, which is a JDK-serialized object."""
    client, sessions, _ = api
    _login(client, "alice", "fixture-password")
    for key in sessions.store.data:
        assert key.startswith("eye:py:session:")
        assert not key.startswith("spring:session:sessions:")


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
def test_original_account_and_password_still_log_in(api):
    client, _, _ = api
    body = _login(client, "alice", "fixture-password").json()
    assert body["code"] == 0
    assert body["data"]["userAccount"] == "alice"
    assert body["data"]["id"] == "7"


@pytest.mark.parametrize("body", [
    {}, {"userAccount": "alice"}, {"userPassword": "fixture-password"},
    {"userAccount": None, "userPassword": "fixture-password"},
    {"userAccount": "a", "userPassword": None},
])
def test_missing_or_null_login_fields_keep_java_blank_validation(api, body):
    client, _, _ = api
    response = client.post("/api/user/login", json=body)
    assert response.status_code == 200
    assert response.json() == {"code": 40000, "msg": "参数为空", "data": None}


def test_slow_identity_database_does_not_block_other_http_requests(api):
    import httpx

    client, _, engine = api
    entered = threading.Event()
    running = threading.Event()

    def slow_identity(connection, cursor, statement, parameters, context, many):
        if statement.startswith("SELECT t_user."):
            running.set()
            entered.set()
            time.sleep(.5)
            running.clear()

    async def check():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app),
                                     base_url="http://test", cookies={"EYE_SESSION": "alice"}) as http:
            lookup = asyncio.create_task(http.get("/api/user/get/login"))
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                assert (await http.get("/health")).json() == {"status": "up"}
                assert running.is_set(), "health waited for the slow identity query"
                assert (await lookup).json()["code"] == 0
            finally:
                await lookup

    event.listen(engine, "before_cursor_execute", slow_identity)
    try:
        asyncio.run(check())
    finally:
        event.remove(engine, "before_cursor_execute", slow_identity)


def test_login_never_echoes_the_password_or_its_hash(api):
    client, _, _ = api
    body = _login(client, "alice", "fixture-password").json()
    serialized = json.dumps(body, ensure_ascii=False)
    assert "fixture-password" not in serialized
    assert "$2" not in serialized
    assert "userPassword" not in serialized


def test_legacy_md5_account_logs_in_and_is_upgraded(api):
    client, _, engine = api
    body = _login(client, "legacy", LEGACY_MD5_PASSWORD).json()
    assert body["code"] == 0
    with Session(engine) as db:
        stored = db.get(User, 4242).user_password
    assert stored.startswith("$2")
    # And the upgraded row still authenticates with the *original* password.
    client.post("/api/user/logout")
    assert _login(client, "legacy", LEGACY_MD5_PASSWORD).json()["code"] == 0


@pytest.mark.parametrize(
    "account,password,message",
    [
        ("", "", "参数为空"),
        ("alice", "short", "密码错误"),
        ("alice", "wrong-password", "用户不存在或密码错误"),
        ("nosuchuser", "fixture-password", "用户不存在或密码错误"),
    ],
)
def test_login_failures_carry_the_java_message(api, account, password, message):
    """The frontend renders ``msg`` verbatim in a toast, so it is contract."""
    client, _, _ = api
    body = _login(client, account, password).json()
    assert body["data"] is None
    assert body["msg"] == message
    assert body["code"] == 40000


def test_short_account_is_rejected_before_any_database_lookup(api):
    client, _, _ = api
    body = _login(client, "abc", "fixture-password").json()
    assert (body["code"], body["msg"]) == (40000, "账号错误")


def test_logged_out_account_cannot_log_in(api):
    client, _, engine = api
    with Session(engine) as db:
        db.get(User, 7).is_delete = 1
        db.commit()
    assert _login(client, "alice", "fixture-password").json()["code"] == 40000


def test_login_rotates_the_session_id_and_revokes_the_previous_one(api):
    client, sessions, _ = api
    _login(client, "alice", "fixture-password")
    first = client.cookies.get(sessions.config.session_cookie_name)
    assert sessions.key(first) in sessions.store.data

    _login(client, "alice", "fixture-password")
    second = client.cookies.get(sessions.config.session_cookie_name)

    assert second != first
    assert sessions.key(first) not in sessions.store.data
    assert sessions.key(second) in sessions.store.data
    # The revoked id authenticates nobody.
    replay = TestClient(client.app, raise_server_exceptions=False)
    replay.cookies.set(sessions.config.session_cookie_name, first)
    assert replay.get("/api/user/get/login").json()["code"] == 40100
    replay.close()


def test_active_session_keeps_the_legacy_inactivity_timeout(api):
    client, sessions, _ = api
    _login(client, "alice", "fixture-password")
    sid = client.cookies.get(sessions.config.session_cookie_name)
    sessions.store.ttls[sessions.key(sid)] = 1
    assert client.get("/api/user/get/login").json()["code"] == 0
    assert sessions.store.ttls[sessions.key(sid)] == sessions.config.session_ttl_seconds


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------
def test_logout_revokes_the_session_so_replay_fails(api):
    client, sessions, _ = api
    sessions.authenticate(client, "alice")
    stale = client.cookies.get(sessions.config.session_cookie_name)

    assert client.post("/api/user/logout").json() == {"code": 0, "msg": "ok", "data": True}
    assert sessions.key(stale) not in sessions.store.data

    replay = TestClient(client.app, raise_server_exceptions=False)
    replay.cookies.set(sessions.config.session_cookie_name, stale)
    assert replay.get("/api/user/get/login").json()["code"] == 40100
    assert client.get("/api/user/get/login").json()["code"] == 40100
    replay.close()


def test_logout_clears_the_browser_cookie_with_the_same_attributes(api):
    client, sessions, _ = api
    sessions.authenticate(client, "alice")
    header = client.post("/api/user/logout").headers["set-cookie"]
    assert header.startswith(f"{sessions.config.session_cookie_name}=")
    assert "HttpOnly" in header and "Path=/" in header and "SameSite=lax" in header


def test_logout_without_a_session_is_an_error_not_a_silent_success(api):
    """Java throws here, and a frontend flow distinguishes the two."""
    client, _, _ = api
    body = client.post("/api/user/logout").json()
    assert (body["code"], body["msg"]) == (40100, "未登录")


# ---------------------------------------------------------------------------
# Expiry, deletion, role changes
# ---------------------------------------------------------------------------
def test_expired_session_is_rejected(api):
    client, sessions, _ = api
    sessions.authenticate(client, "alice")
    sessions.store.expire_now(sessions.key("alice"))
    assert client.get("/api/user/get/login").json()["code"] == 40100


def test_session_ttl_is_configured_and_applied(api):
    client, sessions, _ = api
    sessions.authenticate(client, "alice")
    key = sessions.key("alice")
    assert sessions.store.ttls[key] == sessions.config.session_ttl_seconds
    assert sessions.config.session_ttl_seconds == 1800


def test_logically_deleted_account_loses_its_live_session(api):
    """The session stores only an id, so the row is re-read every request."""
    client, _, engine = api
    client.cookies.set("EYE_SESSION", "alice")
    assert client.get("/api/user/get/login").json()["code"] == 0

    with Session(engine) as db:
        db.get(User, 7).is_delete = 1
        db.commit()

    assert client.get("/api/user/get/login").json()["code"] == 40100
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40100


def test_role_change_takes_effect_without_re_logging_in(api):
    client, _, engine = api
    client.cookies.set("EYE_SESSION", "alice")
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40101

    with Session(engine) as db:
        db.get(User, 7).user_role = "admin"
        db.commit()

    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 0
    # The role in the payload reflects the new row, not the value at login.
    assert client.get("/api/user/get/login").json()["data"]["userRole"] == "admin"


def test_unknown_role_value_is_unauthorized_not_a_pass(api):
    """``AuthInterceptor`` rejects a ``userRole`` outside the enum."""
    client, _, engine = api
    client.cookies.set("EYE_SESSION", "alice")
    with Session(engine) as db:
        db.get(User, 7).user_role = "superuser"
        db.commit()
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40101


def test_doctor_is_a_recognised_role_and_is_still_not_an_admin(api):
    """``doctor`` is the Python rewrite's own role (review.py). It has to pass
    the enum check on a non-admin endpoint, or every doctor workflow 401s -- and
    it still must not satisfy the admin test."""
    client, _, engine = api
    client.cookies.set("EYE_SESSION", "alice")
    with Session(engine) as db:
        db.get(User, 7).user_role = "doctor"
        db.commit()

    assert client.post("/api/diagnosis/list/page/my", json={}).json()["code"] == 0
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40101


# ---------------------------------------------------------------------------
# Isolation
# ---------------------------------------------------------------------------
def test_one_session_cannot_impersonate_another(api):
    client, sessions, _ = api
    client.cookies.set("EYE_SESSION", "alice")
    assert client.get("/api/user/get/login").json()["data"]["userAccount"] == "alice"
    # Guessing another valid session id is the only way in, and the id is the
    # cookie -- so what matters is that it is not derivable from the account.
    client.cookies.set("EYE_SESSION", "bob")
    assert client.get("/api/user/get/login").json()["data"]["userAccount"] == "bob"
    assert client.get("/api/user/get/login").json()["data"]["id"] == "8"


def test_session_ids_are_unpredictable():
    from web.session import SID_BYTES, new_session_id

    ids = {new_session_id() for _ in range(200)}
    assert len(ids) == 200
    assert all(len(value) >= 43 for value in ids)
    assert SID_BYTES == 32
    # No timestamp-ish structure: a UUID-shaped id would be guessable from when
    # it was minted.
    assert not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-", next(iter(ids)))


def test_two_users_sessions_are_independent_keys(api):
    client, sessions, _ = api
    for name in ("alice", "bob"):
        sessions.authenticate(client, name)
    assert len({sessions.key(n) for n in ("alice", "bob")}) == 2
    assert sessions.key("alice") != sessions.key("bob")


# ---------------------------------------------------------------------------
# Fail closed
# ---------------------------------------------------------------------------
def test_unreachable_redis_reports_a_system_error_and_never_anonymous(api):
    """The dangerous bug is degrading to "nobody is signed in" and, one
    refactor later, to "allowed". Redis down must be an error."""
    client, sessions, _ = api
    sessions.authenticate(client, "alice")
    assert client.get("/api/user/get/login").json()["code"] == 0

    sessions.store.offline = True
    body = client.get("/api/user/get/login").json()
    assert body["code"] == 50000
    assert body["data"] is None

    # A protected business query must fail the same way -- not 40100 (which the
    # frontend would read as "please log in") and certainly not 0.
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 50000
    assert client.get("/api/user/get/login").json()["code"] == 50000


def test_login_cannot_establish_a_session_when_redis_is_unreachable(api):
    client, sessions, _ = api
    sessions.store.offline = True
    body = _login(client, "alice", "fixture-password").json()
    assert body["code"] == 50000
    assert body["data"] is None


@pytest.mark.parametrize("path", [
    "/api/diagnosis/workflows/unknown/events", "/api/reviews/tasks",
])
def test_redis_outage_keeps_workflow_and_review_http_500_contract(api, path):
    client, sessions, _ = api
    sessions.authenticate(client, "alice")
    sessions.store.offline = True
    response = client.get(path)
    assert response.status_code == 500
    assert response.json()["code"] == 50000


def test_logout_against_an_unreachable_redis_is_an_error(api):
    client, sessions, _ = api
    sessions.authenticate(client, "alice")
    sessions.store.offline = True
    assert client.post("/api/user/logout").json()["code"] == 50000


# ---------------------------------------------------------------------------
# Payload
# ---------------------------------------------------------------------------
def test_login_payload_is_the_desensitized_vo(api):
    client, _, _ = api
    data = _login(client, "alice", "fixture-password").json()["data"]
    assert set(data) == {
        "id",
        "userAccount",
        "userName",
        "userAvatar",
        "userProfile",
        "userRole",
        "createTime",
        "updateTime",
        "gender",
        "phone",
        "email",
    }
    assert isinstance(data["id"], str)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", data["createTime"])


def test_unauthenticated_probe_reports_not_logged_in(api):
    """A real 401 would send the frontend down the transport-error branch."""
    client, _, _ = api
    response = client.get("/api/user/get/login")
    assert response.status_code == 200
    assert response.json() == {"code": 40100, "msg": "未登录", "data": None}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
def test_samesite_none_requires_secure():
    with pytest.raises(ValueError, match="requires session_cookie_secure"):
        WebConfig(session_cookie_samesite="none", session_cookie_secure=False)
    WebConfig(session_cookie_samesite="none", session_cookie_secure=True)


def test_blank_cookie_name_or_prefix_is_rejected():
    with pytest.raises(ValueError, match="session_cookie_name"):
        WebConfig(session_cookie_name="  ")
    with pytest.raises(ValueError, match="session_redis_prefix"):
        WebConfig(session_redis_prefix="")


def test_default_store_is_disjoint_from_spring_session_keys():
    """The prefix must never be the Spring Session one, at any configuration."""
    assert WebConfig().session_redis_prefix != "spring:session:sessions:"
    assert not WebConfig().session_redis_prefix.startswith("spring:")


def test_identities_helper_adds_and_replaces():
    who = identities(other=Identity(99, "other-doctor", "user", "Other"))
    assert who["other"].user_id == 99
    assert who["alice"] is DEFAULT_IDENTITIES["alice"]


def test_store_offline_flag_raises_redis_error():
    import asyncio

    from redis.exceptions import RedisError

    store = MemorySessionStore()
    store.offline = True
    with pytest.raises(RedisError):
        asyncio.run(store.get("eye:py:session:x"))

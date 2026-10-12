"""Issue 01: HTTP compatibility with a controlled Java session authority.

These are ASGI tests with SQLite and an HTTP transport stub, not live Java,
Redis, COS or model acceptance.
"""

import sys
import asyncio
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.app import create_app
from web.config import WebConfig
from web.db import Base
from web.deps import get_db


@pytest.fixture
def bridge():
    authority = {"active": True, "cookies": [], "role": "admin"}

    def java(request):
        assert request.url.path == "/api/user/get/login"
        cookie = request.headers.get("cookie", "")
        authority["cookies"].append(cookie)
        valid = authority["active"] and cookie in {
            "SESSION=baseline-session", "JSESSIONID=baseline-session"
        }
        return httpx.Response(200, json={
            "code": 0 if valid else 40100,
            "msg": "ok" if valid else "未登录",
            "data": {"id": "7", "userAccount": "baseline", "userRole": authority["role"]}
            if valid else None,
        })

    app = create_app(WebConfig())
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    def database():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = database
    app.state.java_client = httpx.AsyncClient(
        base_url="http://java/api/", transport=httpx.MockTransport(java)
    )
    client = TestClient(app, raise_server_exceptions=False)
    yield client, authority
    client.close()
    asyncio.run(app.state.java_client.aclose())
    engine.dispose()


def test_spring_session_cookie_authorizes_a_business_query(bridge):
    client, authority = bridge
    client.cookies.set("SESSION", "baseline-session")
    response = client.post("/api/user/list/page/vo", json={})
    assert response.status_code == 200
    assert response.json()["code"] == 0
    assert authority["cookies"] == ["SESSION=baseline-session"]


def test_java_logout_revokes_the_next_business_request_even_with_old_cookie(bridge):
    client, authority = bridge
    client.cookies.set("JSESSIONID", "baseline-session")
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 0
    # External Java authority invalidates login; replay the old browser cookie.
    authority["active"] = False
    response = client.post("/api/user/list/page/vo", json={})
    assert response.status_code == 200
    assert response.json()["code"] == 40100


def test_missing_weights_reject_sync_diagnosis_without_creating_a_record(bridge):
    from web.inference import InferenceEngine, InferenceUnavailable

    client, _ = bridge
    client.cookies.set("SESSION", "baseline-session")
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
    client, _ = bridge
    client.cookies.set("SESSION", "baseline-session")
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 0
    client.cookies.set("SESSION", "another-session")
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40100


def test_regular_user_can_query_history_but_cannot_list_users(bridge):
    client, authority = bridge
    authority["role"] = "user"
    client.cookies.set("SESSION", "baseline-session")
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["code"] == 0
    assert client.post("/api/user/list/page/vo", json={}).json()["code"] == 40101


@pytest.mark.parametrize("role", ["user", "unknown"])
def test_browser_cannot_override_the_required_admin_role(bridge, role):
    client, authority = bridge
    authority["role"] = "user"
    client.cookies.set("SESSION", "baseline-session")
    response = client.post("/api/user/list/page/vo", params={"must_role": role}, json={})
    assert response.json()["code"] == 40101

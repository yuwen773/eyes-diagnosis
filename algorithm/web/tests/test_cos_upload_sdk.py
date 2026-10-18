"""Controlled HTTP regression: installed COS SDK, transport replaced only.

SQLite and identity overrides belong only to this regression, never the real
acceptance process. No attributes are added to the installed qcloud_cos module.
"""
import io

import pytest
import requests
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Integer, MetaData, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from web.app import create_app
from web.auth import LoginUser
from web.config import WebConfig
from web.database import get_db
from web.models.diagnosis import Diagnosis
from web.models.knowledge import KnowledgeDocument
from web.routers import diagnosis, knowledge


@pytest.fixture
def sdk_http(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (Diagnosis, KnowledgeDocument):
        table = model.__table__.to_metadata(MetaData())
        table.c.id.type = Integer()
        table.create(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    app = create_app(WebConfig(cos_secret_id="controlled-id", cos_secret_key="controlled-key",
                               cos_region="ap-guangzhou", cos_bucket="acceptance-1234567890",
                               cos_host="https://acceptance.invalid"))
    identity = lambda: LoginUser(id=7, userAccount="controlled", userRole="user")
    app.dependency_overrides[diagnosis.any_user] = identity
    app.dependency_overrides[knowledge.require_user] = identity

    def database():
        with sessions() as session:
            yield session
            session.commit()

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(knowledge, "db_session", sessions)
    # ETL is outside this COS regression; tested by the document upload suite.
    monkeypatch.setattr(knowledge, "process_document", lambda *args: None)
    sent = []
    status = [200]

    def send(self, request, **kwargs):
        sent.append(request)
        response = requests.Response()
        response.status_code = status[0]
        response.headers["ETag"] = '"controlled-etag"'
        response._content = (b"" if status[0] == 200 else
                             b"<Error><Code>AccessDenied</Code><Message>Controlled denial</Message></Error>")
        response.request = request
        return response

    monkeypatch.setattr(requests.Session, "send", send)
    yield TestClient(app), sent, status
    engine.dispose()


@pytest.mark.parametrize("denied", [False, True])
def test_picture_upload_uses_installed_sdk_and_preserves_response(sdk_http, denied):
    client, sent, status = sdk_http
    status[0] = 403 if denied else 200
    image = io.BytesIO()
    Image.new("RGB", (8, 4), "white").save(image, "PNG")
    response = client.post("/api/diagnosis/upload", files={"file": ("eye.png", image.getvalue())}).json()
    assert sent, "HTTP upload did not reach the installed SDK transport"
    assert sent[0].method == "PUT"
    assert "/public/7/" in sent[0].url
    if denied:
        assert response["code"] == 50000 and response["data"] is None
    else:
        assert response["code"] == 0, response
        assert response["data"]["url"].startswith("https://acceptance.invalid//public/")
        assert isinstance(response["data"]["id"], str)


@pytest.mark.parametrize("denied", [False, True])
def test_knowledge_upload_uses_installed_sdk_and_preserves_response(sdk_http, denied):
    client, sent, status = sdk_http
    status[0] = 403 if denied else 200
    response = client.post("/api/knowledge/upload", files={"files": (
        "reference.txt", b"Controlled document with sufficient plain text content for parsing.")}).json()
    assert sent, "HTTP upload did not reach the installed SDK transport"
    assert sent[0].method == "PUT" and sent[0].url.endswith("_reference.txt")
    if denied:
        assert response["code"] == 50001 and "上传失败" in response["msg"]
    else:
        assert response["code"] == 0 and len(response["data"]) == 1, response
        result = client.request("DELETE", "/api/knowledge/delete", json={"id": response["data"][0]}).json()
        assert result["code"] == 0 and result["data"] is True
        assert sent[-1].method == "DELETE"

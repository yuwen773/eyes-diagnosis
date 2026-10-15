"""Chat HTTP/SSE seam; file SQLite and controlled Java/model transports only."""

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.app import create_app
from web.config import WebConfig
from web.db import Base
from web.deps import get_db
from web.tests.session_fixtures import SESSION_COOKIE_NAME, install_sessions  # noqa: E402


@pytest.fixture
def chat_api(tmp_path):
    url = os.getenv("CHAT_TEST_MYSQL_URL")
    if url and not (make_url(url).database or "").startswith("eye_chat_issue05_"):
        raise ValueError("MySQL tests require an isolated eye_chat_issue05_ schema")
    engine = create_engine(url or f"sqlite:///{tmp_path / 'chat.db'}")
    sessions = sessionmaker(engine, expire_on_commit=False)
    calls = []
    clients = []


    def model(request):
        body = json.loads(request.content)
        calls.append(body)
        content = "记得：你说过暗号是橙子。" if "橙子" in json.dumps(body, ensure_ascii=False) else "当前会话没有提供暗号。"
        events = ["data: " + json.dumps({"choices": [{"delta": {"content": content}, "finish_reason": None}]}),
                  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', "data: [DONE]"]
        return httpx.Response(200, text="\n\n".join(events) + "\n\n",
                              headers={"content-type": "text/event-stream"})

    def build(transport=model, seed=None):
        app = create_app(WebConfig(dashscope_api_key="fixture-only"))
        if not url:
            Base.metadata.create_all(engine)
        if seed:
            with sessions() as db:
                seed(db)
                db.commit()

        def database():
            with sessions() as db:
                yield db
                db.commit()

        app.dependency_overrides[get_db] = database
        auth = install_sessions(app, engine)
        app.state.chat_client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
        client = TestClient(app)
        client.cookies.set(SESSION_COOKIE_NAME, "alice")
        clients.append(client)
        return client

    if url:
        # Explicitly reserved disposable schema only. DDL is Flyway's, not metadata.create_all.
        from web.chat.models import ChatAttachment, ChatAudit, ChatMessage, ChatRun, ChatSession, LegacyUpload
        with sessions() as db:
            for model in [ChatAudit, ChatAttachment, ChatRun, ChatMessage, ChatSession, LegacyUpload]:
                db.query(model).delete()
            db.commit()
    yield build, calls
    for client in clients:
        client.close()
        asyncio.run(client.app.state.chat_client.aclose())
    engine.dispose()


def chat(client, thread, message, **extra):
    return client.post("/api/agent/chat/stream", json={"threadId": thread, "message": message, **extra})


def test_current_session_history_reaches_model_after_application_rebuild(chat_api):
    build, calls = chat_api
    client = build()
    first = chat(client, "remember", "暗号是橙子")
    assert first.headers["content-type"].startswith("text/event-stream")
    assert "event: done" in first.text
    client = build()
    second = chat(client, "remember", "我之前说的暗号是什么？")
    assert "橙子" in second.text
    assert [m["role"] for m in calls[-1]["messages"]] == ["system", "user", "assistant", "user"]
    assert calls[-1]["messages"][1]["content"] == "暗号是橙子"
    isolated = chat(client, "separate", "我之前说的暗号是什么？")
    assert "没有提供暗号" in isolated.text
    history = client.get("/api/agent/history/remember").json()["data"]
    assert [m["role"] for m in history["messages"]] == ["USER", "ASSISTANT", "USER", "ASSISTANT"]
    assert isinstance(history["messages"][0]["id"], str)
    assert history["executions"][0]["auditEvents"] == ["STARTED", "COMPLETED"]
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


def test_session_management_and_every_history_operation_enforce_ownership(chat_api):
    build, _ = chat_api
    client = build()
    chat(client, "owned", "会话管理测试")
    assert client.get("/api/agent/sessions").json()["data"][0]["sessionId"] == "owned"
    assert client.put("/api/agent/sessions/owned/title", json={"title": "新标题"}).json()["data"] is True
    assert client.put("/api/agent/sessions/owned/pin", json={"pinned": True}).json()["data"] is True
    exported = client.get("/api/agent/history/owned/export?format=json").json()["data"]
    assert json.loads(exported)["title"] == "新标题"
    client.cookies.set(SESSION_COOKIE_NAME, "bob")
    for method, url, body in [
        ("GET", "/api/agent/history/owned", None),
        ("GET", "/api/agent/history/owned/export", None),
        ("POST", "/api/agent/chat/stream", {"threadId": "owned", "message": "窃取上下文", "userId": 7}),
        ("PUT", "/api/agent/sessions/owned/title", {"title": "篡改"}),
        ("PUT", "/api/agent/sessions/owned/pin", {"pinned": False}),
        ("POST", "/api/agent/sessions/owned/generate-title", {"firstMessage": "篡改"}),
        ("DELETE", "/api/agent/sessions/owned", None),
        ("DELETE", "/api/agent/sessions/batch", {"sessionIds": ["owned"]}),
    ]:
        assert client.request(method, url, json=body).json()["code"] == 40101, url
    assert client.get("/api/agent/sessions").json()["data"] == []
    client.cookies.clear()
    assert chat(client, "anonymous", "问题").json()["code"] == 40100
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    assert client.delete("/api/agent/sessions/owned").json()["data"] is True
    assert chat(client, "owned", "不能复活已删除会话").json()["code"] == 40101


def test_failed_model_is_not_saved_as_a_complete_answer(chat_api):
    build, _ = chat_api

    def truncated(request):
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"未完成的回答"}}]}\n\n')

    client = build(truncated)
    response = chat(client, "failed", "模型故障测试")
    assert "event: error" in response.text
    assert "event: done" not in response.text
    data = build().get("/api/agent/history/failed").json()["data"]
    assert [m["role"] for m in data["messages"]] == ["USER"]
    assert data["executions"][0]["status"] == "FAILED"
    assert data["executions"][0]["auditEvents"] == ["STARTED", "FAILED"]


def test_history_pagination_has_no_overlap_or_unsafe_numeric_ids(chat_api):
    build, _ = chat_api
    client = build()
    chat(client, "pages", "第一轮")
    chat(client, "pages", "第二轮")
    page = client.get("/api/agent/history/pages?limit=2").json()["data"]
    assert page["hasMore"] is True
    older = client.get(f'/api/agent/history/pages?limit=2&beforeId={page["nextCursor"]}').json()["data"]
    assert older["hasMore"] is False
    assert len({m["id"] for m in page["messages"] + older["messages"]}) == 4


def test_uploaded_attachment_is_bound_to_owner_and_session_and_survives_reload(chat_api):
    from web.tests.test_workflow import picture_bytes
    from web.chat.attachments import attachment_store

    class Storage:
        async def put(self, data, name, user_id):
            from uuid import uuid4
            return f"https://fixture.invalid/agent-chat/{user_id}/{uuid4()}.png"

        async def delete(self, url):
            pass

    build, calls = chat_api
    client = build()
    client.app.dependency_overrides[attachment_store] = lambda: Storage()
    uploaded = client.post("/api/agent/image/upload",
        files={"file": ("test.png", picture_bytes(), "image/png")}).json()
    assert uploaded["code"] == 0
    url = uploaded["data"]
    client.cookies.set(SESSION_COOKIE_NAME, "bob")
    assert chat(client, "theft", "图片", imageUrls=[url]).json()["code"] == 40101
    assert client.post("/api/agent/image/upload/delete", json={"url": url}).json()["code"] == 40101
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    assert "event: done" in chat(client, "images", "附件测试", imageUrls=[url]).text
    assert url in json.dumps(calls[-1], ensure_ascii=False)
    assert chat(client, "another", "不能带入另一个会话", imageUrls=[url]).json()["code"] == 40101
    # The old client calls cleanup after every send. Claimed attachments must be retained.
    assert client.post("/api/agent/image/upload/delete", json={"url": url}).json()["data"] is True
    client = build()
    restored = client.get("/api/agent/history/images").json()["data"]["messages"][0]
    assert restored["imageUrls"] == [url]
    assert "event: done" in chat(client, "images", "之前的附件呢？").text
    assert url in json.dumps(calls[-1], ensure_ascii=False)
    assert chat(client, "forged", "伪造地址", imageUrls=["http://127.0.0.1/private"]).json()["code"] == 40101


@pytest.mark.parametrize("payload", [
    'data: {"error":{"message":"secret upstream details"}}\n\n',
    'data: invalid-json\n\n',
    'data: {"choices":[{"delta":{"content":"片段"},"finish_reason":"length"}]}\n\n',
    'data: [DONE]\n\n',
])
def test_invalid_or_incomplete_model_protocol_never_becomes_success(chat_api, payload):
    build, _ = chat_api
    client = build(lambda request: httpx.Response(200, text=payload))
    result = chat(client, "protocol", "问题")
    assert "event: error" in result.text
    assert "event: done" not in result.text
    assert "secret upstream" not in result.text
    assert client.get("/api/agent/history/protocol").json()["data"]["executions"][0]["status"] == "FAILED"


def test_upstream_http_error_and_missing_configuration_are_explicit_failures(chat_api):
    build, _ = chat_api
    for code in [401, 429, 500]:
        client = build(lambda request: httpx.Response(code, text="upstream secret"))
        assert "event: error" in chat(client, f"http-{code}", "问题").text
    client = build()
    client.app.state.config.dashscope_api_key = None
    assert "event: error" in chat(client, "no-key", "问题").text


def test_simultaneous_send_cannot_interleave_same_session_history(chat_api):
    build, _ = chat_api

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def delayed(request):
            entered.set()
            await release.wait()
            return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"完整回答"},"finish_reason":"stop"}]}\n\n')

        client = build(delayed)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app),
                base_url="http://fixture", cookies={SESSION_COOKIE_NAME: "alice"}) as api:
            sending = asyncio.create_task(api.post("/api/agent/chat/stream", json={"threadId": "busy", "message": "首轮"}))
            await asyncio.wait_for(entered.wait(), 5)
            second = await api.post("/api/agent/chat/stream", json={"threadId": "busy", "message": "并发轮"})
            assert second.json()["code"] == 50001
            release.set()
            assert "event: done" in (await sending).text
            history = (await api.get("/api/agent/history/busy")).json()["data"]
            assert [m["content"] for m in history["messages"]] == ["首轮", "完整回答"]

    asyncio.run(scenario())


def test_server_allocates_thread_id_for_missing_or_blank_legacy_requests(chat_api):
    build, _ = chat_api
    client = build()
    for thread_id in [None, ""]:
        response = chat(client, thread_id, "新会话")
        assert "event: done" in response.text
        assert client.get("/api/agent/history/" + response.headers["x-session-id"]).json()["code"] == 0


def test_existing_java_history_and_uploaded_objects_are_adopted_without_checkpoint_deserialization(chat_api):
    from web.chat.models import ChatSession, LegacyUpload

    def seed(db):
        db.add(ChatSession(session_id="java-history", user_id=7, message_count=1, checkpoint_data=b"java-serialized-not-python"))
        # Java saveUserMessage writes SQL NULL, not the Python model's default 'text'.
        db.execute(text("INSERT INTO t_agent_message "
            "(id, sessionId, role, subType, content, tokenCount, isSummary, createdTime) "
            "VALUES (9007199254740993, 'java-history', 'USER', NULL, :content, 0, 0, CURRENT_TIMESTAMP)"),
            {"content": "暗号是橙子"})
        db.add(LegacyUpload(id=1, task_id="java-upload", user_id=7, object_key="agent-chat/7/old.png", status=2))

    build, calls = chat_api
    client = build(seed=seed)
    client.app.state.config.cos_host = "https://fixture.invalid"
    assert "橙子" in chat(client, "java-history", "继续旧会话").text
    assert calls[-1]["messages"][1]["content"] == "暗号是橙子"
    url = "https://fixture.invalid/agent-chat/7/old.png"
    assert "event: done" in chat(client, "java-history", "旧附件", imageUrls=[url]).text
    assert client.get("/api/agent/history/java-history").json()["data"]["messages"][0]["id"] == "9007199254740993"


def test_batch_delete_is_atomic_and_title_generation_does_not_pollute_memory(chat_api):
    build, _ = chat_api
    client = build()
    chat(client, "alice", "第一轮")
    assert client.post("/api/agent/sessions/alice/generate-title", json={"firstMessage": "题目"}).json()["data"] is True
    assert len(client.get("/api/agent/history/alice").json()["data"]["messages"]) == 2
    client.cookies.set(SESSION_COOKIE_NAME, "bob")
    chat(client, "bob", "第二轮")
    client.cookies.set(SESSION_COOKIE_NAME, "alice")
    assert client.request("DELETE", "/api/agent/sessions/batch", json={"sessionIds": ["alice", "bob"]}).json()["code"] == 40101
    assert client.get("/api/agent/history/alice").json()["code"] == 0
    assert client.request("DELETE", "/api/agent/sessions/batch", json={"sessionIds": ["alice"]}).json()["data"] == 1


def test_real_installed_cos_sdk_is_wired_through_upload_and_unbound_cleanup(chat_api, monkeypatch):
    import qcloud_cos
    from web.tests.test_workflow import picture_bytes

    uploaded, deleted = [], []
    monkeypatch.setattr(qcloud_cos.CosS3Client, "put_object", lambda self, **kwargs: uploaded.append(kwargs))
    monkeypatch.setattr(qcloud_cos.CosS3Client, "delete_object", lambda self, **kwargs: deleted.append(kwargs))
    build, _ = chat_api
    client = build()
    config = client.app.state.config
    config.cos_region, config.cos_bucket = "ap-shanghai", "fixture-000"
    config.cos_secret_id, config.cos_secret_key = "fixture-id", "fixture-key"
    config.cos_host = "https://fixture.invalid"
    response = client.post("/api/agent/image/upload", files={"file": ("image.png", picture_bytes(), "image/png")}).json()
    assert response["code"] == 0
    url = response["data"]
    assert url.startswith("https://fixture.invalid/agent-chat/7/")
    assert uploaded[0]["Body"] == picture_bytes()
    assert client.post("/api/agent/image/upload/delete", json={"url": url}).json()["data"] is True
    assert deleted[0]["Key"] == uploaded[0]["Key"]
    assert chat(client, "deleted-image", "不可再次使用", imageUrls=[url]).json()["code"] == 40101

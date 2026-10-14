"""Ticket 15: model intents through chat, versioned decisions and profile reads."""

import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime

import httpx
import pytest

from web.models.user import User
from web.tests.test_chat import chat, chat_api
from web.tests.test_history_retrieval import tool_stream
from web.tests.test_mcp_chat import CODE, mcp_chat
from web.deps import get_db


def seed_user(db):
    db.add(User(id=7, user_account="alice", user_password="unused", user_name="Alice",
        user_profile="旧简介", user_role="user", edit_time=datetime(2026, 1, 1),
        create_time=datetime(2026, 1, 1), update_time=datetime(2026, 1, 1)))


def pending(client, thread="profile"):
    response = chat(client, thread, "把我的简介改为眼科学生")
    assert "event: done" in response.text, response.text
    return client.get(f"/api/agent/tool-confirmations?sessionId={thread}").json()["data"][-1]


def decide(client, row, action="approve", **changes):
    body = {"idempotencyKey": row["idempotencyKey"], "expectedContentDigest": row["contentDigest"]}
    body.update(changes)
    return client.post(f'/api/agent/tool-confirmations/{row["confirmationId"]}/{action}', json=body)


def test_chat_profile_intent_previews_then_approval_writes_once_after_restart(chat_api):
    build, _ = chat_api
    client = build(lambda request: tool_stream('{"userProfile":"眼科学生"}', name="propose_profile_update"), seed=seed_user)
    row = pending(client)
    assert row["status"] == "PENDING"
    assert row["content"]["before"]["userProfile"] == "旧简介"
    assert row["content"]["after"]["userProfile"] == "眼科学生"
    assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "旧简介"
    client = build()
    receipt = decide(client, row).json()["data"]
    assert receipt["status"] == "APPROVED"
    assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "眼科学生"
    # A replay returns the receipt without overwriting a later direct edit.
    client.post("/api/user/update/userCenter", json={"userName": "Alice", "userProfile": "后来编辑"})
    assert decide(build(), row).json()["data"] == receipt
    assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "后来编辑"


@pytest.mark.parametrize("scenario", ["reject", "expire", "cross-user", "digest", "key", "parameters", "role", "adapter"])
def test_unapproved_or_changed_operations_never_modify_profile(chat_api, scenario, monkeypatch):
    build, _ = chat_api
    client = build(lambda request: tool_stream('{"userProfile":"眼科学生"}', name="propose_profile_update"), seed=seed_user)
    row = pending(client)
    if scenario == "reject":
        assert decide(client, row, "reject").json()["data"]["status"] == "REJECTED"
        response = decide(client, row)
    elif scenario == "cross-user":
        client.cookies.set("SESSION", "bob")
        response = decide(client, row)
        client.cookies.set("SESSION", "alice")
    elif scenario in {"expire", "role"}:
        from web.chat.tool_writes import ToolConfirmation
        generator = client.app.dependency_overrides[get_db]()
        db = next(generator)
        if scenario == "expire":
            db.get(ToolConfirmation, row["confirmationId"]).expires_at = datetime(2000, 1, 1)
        else:
            db.get(User, 7).user_role = "admin"
        db.commit()
        generator.close()
        response = decide(client, row)
        if scenario == "role":
            generator = client.app.dependency_overrides[get_db]()
            db = next(generator)
            db.get(User, 7).user_role = "user"
            db.commit()
            generator.close()
    elif scenario == "parameters":
        client.post("/api/user/update/userCenter", json={"userName": "Alice", "userProfile": "直接修改"})
        response = decide(client, row)
        assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "直接修改"
    elif scenario == "adapter":
        monkeypatch.setattr("web.chat.tool_writes.ADAPTER_VERSION", "v2")
        response = decide(client, row)
    else:
        response = decide(client, row, **({"expectedContentDigest": "0" * 64} if scenario == "digest" else {"idempotencyKey": "forged"}))
    assert response.json().get("code", -1) != 0, response.text
    if scenario != "parameters":
        assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "旧简介"
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


@pytest.mark.parametrize("arguments", ['{"userProfile":"new","userId":8}', '{"userProfile":"new","approval":true}',
    '{"userProfile":"new","userRole":"admin"}', '{"userProfile":3}', '{"userProfile":"' + "x" * 513 + '"}'])
def test_model_can_only_propose_registered_profile_fields(chat_api, arguments):
    build, _ = chat_api
    client = build(lambda request: tool_stream(arguments, name="propose_profile_update"), seed=seed_user)
    assert "event: error" in chat(client, "forged", "修改资料").text
    assert client.get("/api/agent/tool-confirmations?sessionId=forged").json()["data"] == []
    assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "旧简介"


@pytest.mark.parametrize("change", [None, "schema", "revoke", "readonly", "revoke-during-call"])
def test_registered_mcp_intent_uses_consent_adapter_and_never_remote_write(mcp_chat, change):
    import hashlib
    client, _, selected, requests, behavior = mcp_chat
    generator = client.app.dependency_overrides[get_db]()
    db = next(generator)
    seed_user(db)
    db.commit()
    generator.close()
    original = client.app.state.mcp_transport
    async def wire(request):
        response = await original.handle_async_request(request)
        await response.aread()
        if json.loads(request.content)["method"] == "tools/list":
            body = response.json()
            tool = body["result"]["tools"][0]
            tool.update(name="update_my_profile", inputSchema={"type": "object", "properties": {
                "userProfile": {"type": "string"}}, "required": ["userProfile"], "additionalProperties": False},
                annotations={"readOnlyHint": False})
            if behavior.get("changed"):
                tool["description"] = "changed tool version"
            if change == "readonly":
                tool["annotations"]["readOnlyHint"] = True
            return httpx.Response(200, json=body)
        return response
    client.app.state.mcp_transport = httpx.MockTransport(wire)
    config = client.app.state.config
    config.mcp_profile_tools = f"{CODE}/update_my_profile" if change != "readonly" else ""
    config.mcp_readonly_tools = f"{CODE}/update_my_profile"
    alias = "mcp_" + hashlib.sha256(f"{CODE}/update_my_profile".encode()).hexdigest()[:32]
    def model(request):
        if change == "revoke-during-call":
            config.mcp_profile_tools = ""
        return tool_stream('{"userProfile":"眼科学生"}', name=alias)
    client.app.state.chat_client = httpx.AsyncClient(transport=httpx.MockTransport(model))
    if change in {"readonly", "revoke-during-call"}:
        assert "event: error" in chat(client, "profile", "修改简介").text
    else:
        row = pending(client)
        assert row["content"]["source"]["kind"] == "mcp"
        assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "旧简介"
        if change == "schema":
            behavior["changed"] = True
        elif change == "revoke":
            config.mcp_profile_tools = ""
        response = decide(client, row)
        if change:
            assert response.json().get("code", -1) != 0
        else:
            assert response.json()["data"]["status"] == "APPROVED"
    assert not any(item["method"] == "tools/call" for item in requests)
    assert client.get("/api/agent/profile").json()["data"]["userProfile"] == ("眼科学生" if change is None else "旧简介")


def test_failed_profile_write_rolls_back_consent_and_can_retry(chat_api):
    from sqlalchemy import event
    build, _ = chat_api
    client = build(lambda request: tool_stream('{"userProfile":"眼科学生"}', name="propose_profile_update"), seed=seed_user)
    row = pending(client)
    generator = client.app.dependency_overrides[get_db]()
    db = next(generator)
    engine = db.get_bind()
    generator.close()
    def fail(connection, cursor, statement, parameters, context, many):
        if statement.startswith("UPDATE t_user "):
            raise RuntimeError("controlled profile write failure")
    event.listen(engine, "before_cursor_execute", fail)
    try:
        with pytest.raises(RuntimeError, match="controlled profile write failure"):
            decide(client, row)
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "旧简介"
    assert client.get("/api/agent/tool-confirmations?sessionId=profile").json()["data"][0]["status"] == "PENDING"
    assert decide(client, row).json()["data"]["status"] == "APPROVED"


def test_concurrent_fresh_api_processes_and_replays_apply_one_profile_effect(chat_api):
    from sqlalchemy import text
    build, _ = chat_api
    client = build(lambda request: tool_stream('{"userProfile":"眼科学生"}', name="propose_profile_update"), seed=seed_user)
    row = pending(client)
    generator = client.app.dependency_overrides[get_db]()
    db = next(generator)
    engine = db.get_bind()
    filename = engine.url.database
    db.execute(text("CREATE TABLE profile_effects (userId BIGINT)"))
    db.execute(text("CREATE TRIGGER count_profile_effect AFTER UPDATE ON t_user BEGIN INSERT INTO profile_effects VALUES (NEW.id); END"))
    db.commit()
    generator.close()
    script = '''
import json, sys, time
from pathlib import Path
import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from web.app import create_app
from web.config import WebConfig
from web.deps import get_db
app = create_app(WebConfig())
engine = create_engine("sqlite:///" + sys.argv[1])
factory = sessionmaker(engine, expire_on_commit=False)
mode = sys.argv[3]
marker = Path(sys.argv[1] + ".pending-read")
committed = Path(sys.argv[1] + ".committed")
@event.listens_for(engine, "before_cursor_execute")
def coordinate(connection, cursor, statement, parameters, context, many):
    if not statement.startswith("SELECT t_user.") or mode == "replay":
        return
    if mode == "slow":
        marker.touch()
    wait_for = committed if mode == "slow" else marker
    deadline = time.monotonic() + 15
    while not wait_for.exists():
        if time.monotonic() > deadline:
            raise RuntimeError("approval race coordination timed out")
        time.sleep(.01)
def database():
    with factory() as db:
        yield db
        db.commit()
app.dependency_overrides[get_db] = database
app.state.java_client = httpx.AsyncClient(base_url="http://java/api/", transport=httpx.MockTransport(
    lambda request: httpx.Response(200, json={"code": 0, "data": {"id": "7", "userAccount": "fixture", "userRole": "user"}})))
row = json.loads(sys.argv[2])
client = TestClient(app)
client.cookies.set("SESSION", "alice")
response = client.post("/api/agent/tool-confirmations/" + row["confirmationId"] + "/approve", json={
    "idempotencyKey": row["idempotencyKey"], "expectedContentDigest": row["contentDigest"]})
print(json.dumps(response.json()))
if mode == "fast":
    committed.touch()
'''
    def start(mode="replay"):
        return subprocess.Popen([sys.executable, "-c", script, filename, json.dumps(row), mode],
            cwd=Path(__file__).resolve().parents[2], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    def result(process):
        stdout, stderr = process.communicate(timeout=45)
        assert process.returncode == 0, stderr
        return json.loads(stdout)
    results = [result(process) for process in [start("fast"), start("slow")]]
    assert all(response["code"] == 0 for response in results), results
    assert result(start())["data"]["status"] == "APPROVED"
    assert result(start())["data"]["status"] == "APPROVED"
    assert client.get("/api/agent/profile").json()["data"]["userProfile"] == "眼科学生"
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM profile_effects")) == 1

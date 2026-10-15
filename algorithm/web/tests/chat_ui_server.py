"""Loopback-only browser fixture. Synthetic sessions/model/COS, persistent file SQLite.

Never deploy: the verifier sets CHAT_UI_DIRECTORY to its disposable directory.
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi.responses import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from web.app import create_app
from web.chat.attachments import attachment_store
from web.config import WebConfig
from web.db import Base
from web.deps import get_db
from web.tests.session_fixtures import install_sessions

DIRECTORY = Path(os.environ["CHAT_UI_DIRECTORY"])
app = create_app(WebConfig(dashscope_api_key="controlled-fixture-only",
                          cors_allowed_origins=["http://127.0.0.1:15175"]))


class SlowStream(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
        await asyncio.sleep(300)


def model(request):
    payload = json.loads(request.content)
    with (DIRECTORY / "model-requests.jsonl").open("a", encoding="utf-8") as output:
        output.write(json.dumps(payload, ensure_ascii=False) + "\n")
    text = json.dumps(payload["messages"], ensure_ascii=False)
    current = str(payload["messages"][-1]["content"])
    if "慢速中断测试" in current:
        return httpx.Response(200, stream=SlowStream())
    if "故障测试" in current:
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"不完整内容"}}]}\n\n')
    content = "记得：本会话的暗号是橙子。" if "橙子" in text else "当前会话没有提供暗号。"
    events = [{"choices": [{"delta": {"content": content}, "finish_reason": None}]},
              {"choices": [{"delta": {}, "finish_reason": "stop"}]}]
    return httpx.Response(200, text="".join("data: " + json.dumps(e, ensure_ascii=False) + "\n\n" for e in events)
                          + "data: [DONE]\n\n", headers={"content-type": "text/event-stream"})


class FixtureStorage:
    async def put(self, data, name, user_id):
        key = uuid4().hex + ".png"
        (DIRECTORY / key).write_bytes(data)
        return "http://127.0.0.1:18805/fixture/images/" + key

    async def delete(self, url):
        (DIRECTORY / url.rsplit("/", 1)[-1]).unlink(missing_ok=True)


@app.get("/fixture/images/{key}")
def image(key: str):
    # Only fixture-generated opaque names, no path traversal.
    if len(key) != 36 or not key.endswith(".png") or any(c not in "0123456789abcdef" for c in key[:-4]):
        return Response(status_code=404)
    return Response((DIRECTORY / key).read_bytes(), media_type="image/png")


@asynccontextmanager
async def lifespan(application):
    engine = create_engine(f"sqlite:///{DIRECTORY / 'chat.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)

    def database():
        with factory() as db:
            yield db
            db.commit()

    application.dependency_overrides[get_db] = database
    application.dependency_overrides[attachment_store] = lambda: FixtureStorage()
    install_sessions(application, engine)
    application.state.chat_client = httpx.AsyncClient(transport=httpx.MockTransport(model))
    try:
        yield
    finally:
        await application.state.chat_client.aclose()
        engine.dispose()


app.router.lifespan_context = lifespan

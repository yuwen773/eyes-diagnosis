"""Loopback-only issue09 HTTP fixture; synthetic services/models, never deploy."""

import asyncio
import copy
from typing import Literal

import pytest
import uvicorn
from fastapi import Request

from web.tests.test_controlled_evidence import evidence_api, govern
from web.tests.test_validated_explanation import drain, explanation_api


def main():
    patch = pytest.MonkeyPatch()
    fixture = evidence_api.__wrapped__(patch)
    evidence = next(fixture)
    client, sessions, doc_id, model = explanation_api.__wrapped__(evidence)
    chunks = evidence[2]
    original_chunks = copy.deepcopy(chunks)
    valid_reply = copy.deepcopy(model["reply"])
    app = client.app
    app.state.mode = "published"

    @app.get("/api/user/get/login")
    async def session_probe(request: Request):
        response = await app.state.java_client.get("/user/get/login",
            headers={"Cookie": request.headers.get("cookie", "")})
        return response.json()

    @app.post("/__fixture/mode/{mode}")
    def set_mode(mode: Literal["published", "insufficient", "rejected", "clinical"]):
        app.state.mode = mode
        model["reply"] = copy.deepcopy(valid_reply)
        chunks.clear()
        if mode != "insufficient":
            chunks.update(copy.deepcopy(original_chunks))
        if mode == "rejected":
            model["reply"]["claims"][0]["text"] = "参考资料证明您患有青光眼，患病概率为 99%。"
        return {"mode": mode}

    @app.post("/__fixture/withdraw")
    def withdraw():
        client.cookies.set("SESSION", "admin")
        response = govern(client, doc_id, reviewStatus="WITHDRAWN", expectedVersion=1)
        client.cookies.set("SESSION", "alice")
        return response.json()

    async def fixture_app(scope, receive, send):
        await app(scope, receive, send)
        if (scope["type"] == "http" and scope["method"] == "POST"
                and scope["path"] == "/api/diagnosis/workflows"):
            await asyncio.to_thread(drain, sessions, requires_review=app.state.mode == "clinical")

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

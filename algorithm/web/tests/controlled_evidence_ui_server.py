"""Loopback-only UI fixture. Synthetic Java/COS/Chroma/embedding + SQLite; never deploy."""

import pytest
import uvicorn
from fastapi import Request

from web.tests.test_controlled_evidence import evidence_api, finish_workflow, govern, upload


def main():
    patch = pytest.MonkeyPatch()
    fixture = evidence_api.__wrapped__(patch)
    client, sessions, _, _ = next(fixture)
    doc_id = upload(client)
    client.cookies.set("SESSION", "admin")
    govern(client, doc_id)
    client.cookies.set("SESSION", "alice")
    sufficient = finish_workflow(client, sessions)["workflowId"]
    insufficient = finish_workflow(client, sessions, key="insufficient-ui", label="other")["workflowId"]
    app = client.app

    @app.get("/api/user/get/login")
    async def session_probe(request: Request):
        response = await app.state.java_client.get("/user/get/login",
            headers={"Cookie": request.headers.get("cookie", "")})
        return response.json()

    @app.get("/__fixture")
    def fixture_ids():
        return {"documentId": doc_id, "sufficient": sufficient, "insufficient": insufficient}

    try:
        uvicorn.run(app, host="127.0.0.1", port=15281, lifespan="off")
    finally:
        try:
            next(fixture)
        except StopIteration:
            pass
        patch.undo()


if __name__ == "__main__":
    main()

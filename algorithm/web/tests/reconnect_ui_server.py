"""Loopback issue18 fixture, real routes/worker; synthetic services and SQLite."""

import json
from pathlib import Path
import tempfile

import httpx
from httpx import AsyncClient
import pytest
import uvicorn
from sqlalchemy import create_engine, func, select

from web.models.diagnosis import Diagnosis
from web.tests.test_controlled_evidence import evidence_api
from web.tests import test_controlled_evidence
from web.tests.test_validated_explanation import explanation_api
from web.tests.test_final_clinical_review import identities, run
from web.tests.test_workflow_inference import ControlledEngine, prediction
from web.workflow.inference import WorkflowInference
from web.config import WebConfig


def main():
    patch = pytest.MonkeyPatch()
    directory = tempfile.TemporaryDirectory(prefix="eye-reconnect-ui-")
    # Multiple browser tabs need independent DB connections, not the unit
    # fixture's single in-memory connection shared across request threads.
    patch.setattr(test_controlled_evidence, "create_engine", lambda *args, **kwargs:
        create_engine(f"sqlite:///{Path(directory.name) / 'reconnect.db'}"))
    fixture = evidence_api.__wrapped__(patch)
    evidence = next(fixture)
    client, sessions, _, model = explanation_api.__wrapped__(evidence)
    identities(client)
    app = client.app
    engine = ControlledEngine(prediction(requires_review=True))
    adapter = WorkflowInference(WebConfig(dashscope_api_key="controlled-key"), engine=engine)
    chat_calls = []

    def chat(request):
        chat_calls.append(json.loads(request.content))
        if "故障测试" in request.content.decode():
            return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"未完成片段"}}]}\n\n')
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"已持久化的完整回答"}}]}\n\n'
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')

    app.state.chat_client = AsyncClient(transport=httpx.MockTransport(chat))

    @app.post("/__fixture/run")
    def advance():
        run(sessions, adapter)
        return proof()

    @app.get("/__fixture/proof")
    def proof():
        with sessions() as db:
            return {"inferenceCalls": engine.calls, "explanationCalls": len(model["requests"]),
                    "chatCalls": len(chat_calls),
                    "formalRecords": db.scalar(select(func.count()).select_from(Diagnosis))}

    try:
        uvicorn.run(app, host="127.0.0.1", port=15281, lifespan="off")
    finally:
        try:
            next(fixture)
        except StopIteration:
            pass
        patch.undo()
        directory.cleanup()


if __name__ == "__main__":
    main()

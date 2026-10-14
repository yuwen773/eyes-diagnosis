"""Loopback-only issue10 fixture; all infrastructure and models are controlled."""

import asyncio
from typing import Literal

import pytest
import uvicorn
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from web.tests.test_controlled_evidence import evidence_api
from web.tests.test_validated_explanation import explanation_api
from web.tests.test_final_clinical_review import identities, run
from web.tests.test_workflow_inference import ControlledEngine, prediction
from web.config import WebConfig
from web.workflow.inference import WorkflowInference
from web.workflow.models import InferenceEnvelopeRow, WorkflowEvent


def main():
    patch = pytest.MonkeyPatch()
    fixture = evidence_api.__wrapped__(patch)
    evidence = next(fixture)
    client, sessions, _, model = explanation_api.__wrapped__(evidence)
    identities(client)
    app = client.app
    cors_app = CORSMiddleware(app, allow_origins=["http://127.0.0.1:15382"],
        allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    app.state.mode = "valid"
    engine = ControlledEngine(prediction(requires_review=True))
    adapter = WorkflowInference(WebConfig(dashscope_api_key="controlled-key"), engine=engine)

    @app.get("/api/user/get/login")
    async def session_probe(request: Request):
        response = await app.state.java_client.get("/user/get/login",
            headers={"Cookie": request.headers.get("cookie", "")})
        return response.json()

    @app.post("/__fixture/mode/{mode}")
    def mode(mode: Literal["valid", "abstention", "quality"]):
        app.state.mode = mode
        return {"mode": mode}

    @app.get("/__fixture/proof")
    def proof():
        with sessions() as db:
            return {"inferenceCalls": engine.calls, "explanationCalls": len(model["requests"]),
                "envelopes": [{"id": row.envelope_id, "workflow": row.workflow_id,
                    "prediction": row.prediction_snapshot, "model": row.model_fingerprint,
                    "epoch": row.inference_epoch} for row in db.scalars(select(InferenceEnvelopeRow))],
                "doctorEvents": [{"type": row.event_type, "workflow": row.workflow_id}
                    for row in db.scalars(select(WorkflowEvent).where(WorkflowEvent.actor_type == "DOCTOR"))]}

    async def fixture_app(scope, receive, send):
        await cors_app(scope, receive, send)
        if scope["type"] == "http" and scope["method"] == "POST":
            if scope["path"] == "/api/diagnosis/workflows":
                abstained = app.state.mode == "abstention"
                engine.result = prediction(requires_review=True, rejected=abstained, is_ood=abstained,
                    abstain_reason="OOD" if abstained else "", quality_reasons="blur" if app.state.mode == "quality" else "")
                await asyncio.to_thread(run, sessions, adapter)
            elif scope["path"].endswith("/submit"):
                await asyncio.to_thread(run, sessions, adapter)

    try:
        uvicorn.run(fixture_app, host="127.0.0.1", port=15381, lifespan="off", access_log=False)
    finally:
        try:
            next(fixture)
        except StopIteration:
            pass
        patch.undo()


if __name__ == "__main__":
    main()

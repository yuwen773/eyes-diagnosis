"""Issue 19 child roles. Only model/COS boundaries are controlled.

API uses the production lifespan, MySQL dependencies, Redis and Java auth.
Worker uses the production graph/checkpointer/evidence/explanation clients.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse

from web.config import WebConfig


def trace(kind):
    with Path(os.environ["REAL_SERVICES_TRACE"]).open("a", encoding="utf-8") as output:
        output.write(json.dumps({"kind": kind, "pid": os.getpid()}) + "\n")


def provider_app():
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "up"}

    @app.post("/v1/embeddings")
    async def embeddings(request: Request):
        body = await request.json()
        if os.environ["REAL_SERVICES_EMBEDDING"] == "real":
            # Real provider IO, using the unchanged production embedding adapter.
            from web.vectorstore import DashScopeEmbedder

            async with httpx.AsyncClient(timeout=30) as client:
                vectors = await DashScopeEmbedder(os.environ["DASHSCOPE_API_KEY"],
                    os.getenv("REAL_SERVICES_EMBEDDING_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
                    body["model"], client=client).embed(body["input"])
            trace("realEmbedding")
        else:
            vectors = [[(b + 1) / 256 for b in hashlib.sha256(text.encode()).digest()[:8]]
                       for text in body["input"]]
            trace("controlledEmbedding")
        return {"data": [{"index": i, "embedding": v} for i, v in enumerate(vectors)]}

    @app.post("/v1/chat/completions")
    async def chat(request: Request):
        body = await request.json()
        if not body.get("stream"):
            trace("explanation")
            sources = json.loads(body["messages"][1]["content"])
            draft = {"claims": [{"claimId": "c1", "type": "GENERAL_DISEASE_INFORMATION",
                "text": sources[0]["quotedText"], "citationIds": [sources[0]["citationId"]]}]}
            return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(draft, ensure_ascii=False)}}]}
        trace("chat")
        message = body["messages"][-1]["content"]
        if message == "issue19-provider-error":
            return Response(status_code=503)
        if message == "issue19-history":
            delta: dict[str, Any] = {"tool_calls": [{"index": 0, "id": "history_call", "type": "function",
                "function": {"name": "query_diagnosis_history", "arguments": "{}"}}]}
            finish = "tool_calls"
        else:
            delta, finish = {"content": "受控聊天回复，仅验证编排。"}, "stop"
        events = [{"choices": [{"delta": delta, "finish_reason": None}]},
                  {"choices": [{"delta": {}, "finish_reason": finish}]}]
        return StreamingResponse(iter(["data: " + json.dumps(event, ensure_ascii=False) + "\n\n" for event in events]
                                      + ["data: [DONE]\n\n"]), media_type="text/event-stream")

    return app


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("role", choices=["provider", "api", "worker"])
    parser.add_argument("--port", type=int)
    parser.add_argument("--mode", choices=["pass", "quality", "final"], default="pass")
    args = parser.parse_args()
    config = WebConfig.from_env()
    if args.role == "provider":
        app = provider_app()
    elif args.role == "api":
        from web.app import create_app
        from web.routers import knowledge
        from web.chat.attachments import attachment_store

        directory = Path(os.environ["REAL_SERVICES_OBJECTS"])
        directory.mkdir(parents=True, exist_ok=True)
        # Test-only COS adapter; parser, ETL, embedding and vector IO stay real.
        def put_object(key: str, data: bytes) -> None:
            (directory / key).write_bytes(data)

        knowledge._put_object = put_object
        knowledge._delete_object = lambda key: (directory / key).unlink(missing_ok=True)

        class LocalAttachments:
            async def put(self, data, name, user_id):
                key = hashlib.sha256(data).hexdigest() + ".png"
                (directory / key).write_bytes(data)
                return "https://issue19.invalid/" + key

            async def delete(self, url):
                (directory / url.rsplit("/", 1)[-1]).unlink(missing_ok=True)

        app = create_app(config)
        app.dependency_overrides[attachment_store] = LocalAttachments
    else:
        from web.db import init_engine, dispose_engine, get_session_factory
        from web.tests.test_workflow_inference import ControlledEngine, prediction
        from web.workflow.inference import WorkflowInference
        from web.workflow.worker import Worker

        class Engine(ControlledEngine):
            def load(self):
                pass

            def diagnose(self, image, content_type=None):
                trace("inference")
                return super().diagnose(image, content_type)

        init_engine(config)
        adapter = WorkflowInference(config, engine=Engine(prediction(
            quality_score=40 if args.mode == "quality" else 100,
            quality_reasons="blur" if args.mode == "quality" else "",
            requires_review=args.mode == "final")))
        try:
            for _ in range(40):
                if not Worker(get_session_factory(), inference=adapter).run_once():
                    return
            raise RuntimeError("Worker did not reach a durable stop")
        finally:
            dispose_engine()
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

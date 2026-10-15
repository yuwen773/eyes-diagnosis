"""Issue 17 child processes: production routes/Worker, controlled external IO only."""

import argparse
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import time

import httpx
from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from web.app import create_app
from web.config import WebConfig
from web.deps import get_db
from web.tests.session_fixtures import Identity, install_sessions
from web.tests.test_workflow_inference import ControlledEngine, prediction
from web.workflow.inference import WorkflowInference
from web.workflow.worker import Worker

REFERENCE = "青光眼是一类可能影响视神经的眼病，需要眼科检查评估。"

#: The callers these cases sign in as. ``alice`` owns the workflow and its
#: reference document (both pinned to id 7 by ``test_human_wait_restart``);
#: ``doctor`` is a separate row with the role ``review.py`` requires, and is
#: deliberately *not* the owner -- reviewing one's own case is refused.
#: ``bob`` is a third signed-in non-owner, used to show that an ordinary user
#: gets 40101 rather than 40100: the answer has to distinguish "who are you"
#: from "may you do this", or the frontend shows "please sign in" to somebody
#: who is.
WAIT_IDENTITIES = {
    "alice": Identity(7, "alice", "user", "Alice"),
    "bob": Identity(8, "bob", "user", "Bob"),
    "doctor": Identity(10, "doctor", "doctor", "Doctor"),
}


def trace(kind):
    with Path(os.environ["HUMAN_WAIT_TRACE"]).open("a", encoding="utf-8") as output:
        output.write(json.dumps({"kind": kind, "pid": os.getpid()}) + "\n")


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("role", choices=["api", "worker"])
    parser.add_argument("--port", type=int)
    parser.add_argument("--mode", choices=["quality", "final", "pass", "no-inference"], default="no-inference")
    args = parser.parse_args()
    url = os.environ["HUMAN_WAIT_DATABASE_URL"]
    engine = create_engine(url, connect_args={"init_command": "SET time_zone = '+08:00'"}
                           if url.startswith("mysql") else {})
    sessions = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    config = WebConfig(dashscope_api_key="controlled-key")

    if args.role == "api":
        import uvicorn

        app = create_app(config)

        def database(request: Request):
            with sessions() as db:
                yield db
                if "/save-confirmation" in request.url.path:
                    # Make the post-response cleanup window deterministic.
                    # Routes must commit before acknowledging durable decisions.
                    time.sleep(.2)
                db.commit()

        @asynccontextmanager
        async def lifespan(application):
            # Ticket 02: authentication is Python's own -- a Redis session that
            # resolves to a `t_user` row re-read on every request, not a probe of
            # a Java controller. Only one API process runs at a time here, and
            # every restart re-authenticates by cookie, so the store can live in
            # this process while the *rows* live in the shared database. That
            # split is what the restart cases are actually testing: the workflow
            # survives because the data is durable, not because the session is.
            install_sessions(application, engine=engine, who=WAIT_IDENTITIES)
            yield
            engine.dispose()

        app.dependency_overrides[get_db] = database
        app.router.lifespan_context = lifespan
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
        return

    from web import evidence

    def query_chunks(config, text, document_ids):
        doc_id = int(os.environ["HUMAN_WAIT_DOCUMENT_ID"])
        assert doc_id in document_ids
        return {"ids": [[f"doc_{doc_id}_chunk_0"]], "documents": [[REFERENCE]],
                "metadatas": [[{"documentId": doc_id, "ownerUserId": 7, "docId": str(doc_id),
                                "source": f"https://fixture.invalid/{doc_id}.txt"}]], "distances": [[0.05]]}

    def explanation(request):
        trace("explanation")
        sources = json.loads(json.loads(request.content)["messages"][1]["content"])
        draft = {"claims": [{"claimId": "c1", "type": "GENERAL_DISEASE_INFORMATION",
                             "text": sources[0]["quotedText"], "citationIds": [sources[0]["citationId"]]}]}
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {
            "content": json.dumps(draft, ensure_ascii=False)}}]})

    class Engine(ControlledEngine):
        def load(self):
            pass

        def diagnose(self, image, content_type=None):
            trace("inference")
            if args.mode == "no-inference":
                raise AssertionError("committed inference must not run again")
            return super().diagnose(image, content_type)

    evidence.query_chunks = query_chunks
    real_client = httpx.Client
    setattr(httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(explanation), **kwargs))
    adapter = WorkflowInference(config, engine=Engine(prediction(
        quality_score=40 if args.mode == "quality" else 100,
        quality_reasons="blur" if args.mode == "quality" else "",
        requires_review=args.mode == "final")))
    try:
        for _ in range(25):
            if not Worker(sessions, inference=adapter).run_once():
                print("idle", flush=True)
                return
        raise AssertionError("Worker did not reach a durable stop")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

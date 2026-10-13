"""Loopback browser fixture: SQLite, Java transport double and controlled inference.

Never deploy this module. It provides synthetic identities only to the UI verifier.
"""

import asyncio
from contextlib import asynccontextmanager
from tempfile import TemporaryDirectory

import httpx
from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from web.app import create_app
from web.config import WebConfig
from web.db import Base
from web.deps import get_db
from web.tests.test_workflow_inference import prediction
from web.inference import InferenceResult
from web.workflow.inference import WorkflowInference
from web.workflow.worker import Worker


def java(request):
    name = request.headers.get("cookie", "").split("=")[-1]
    identity = {"alice": (7, "user"), "doctor": (9, "doctor"), "other-doctor": (10, "doctor")}.get(name)
    return httpx.Response(200, json={"code": 0 if identity else 40100, "msg": "ok", "data": {
        "id": str(identity[0]), "userAccount": name, "userName": name, "userRole": identity[1],
    } if identity else None})


app = create_app(WebConfig(cors_allowed_origins=["http://127.0.0.1:15174"]))


class ControlledQualityEngine:
    is_loaded = True

    def load(self) -> None:
        raise AssertionError("The controlled browser engine is already loaded")

    def diagnose(self, image: bytes, content_type: str | None = None) -> InferenceResult:
        return prediction(quality_score=40, quality_reasons="blur")


@app.get("/api/user/get/login")
async def session_probe(request: Request):
    # Production Nginx routes this to Java; only this browser fixture supplies it.
    response = await app.state.java_client.get("/user/get/login",
        headers={"Cookie": request.headers.get("cookie", "")})
    return response.json()


@asynccontextmanager
async def lifespan(application):
    with TemporaryDirectory(prefix="eye-quality-ui-") as directory:
        engine = create_engine(f"sqlite:///{directory}/fixture.db")
        Base.metadata.create_all(engine)
        sessions = sessionmaker(engine, expire_on_commit=False)

        def database():
            with sessions() as db:
                yield db
                db.commit()

        application.dependency_overrides[get_db] = database
        application.state.java_client = httpx.AsyncClient(base_url="http://java/api/",
            transport=httpx.MockTransport(java))
        worker = Worker(sessions, inference=WorkflowInference(WebConfig(), engine=ControlledQualityEngine()))
        stopping = asyncio.Event()

        async def execute():
            while not stopping.is_set():
                await asyncio.to_thread(worker.run_once)
                await asyncio.sleep(.05)

        execution = asyncio.create_task(execute())
        try:
            yield
        finally:
            stopping.set()
            await execution
            await application.state.java_client.aclose()
            engine.dispose()


app.router.lifespan_context = lifespan

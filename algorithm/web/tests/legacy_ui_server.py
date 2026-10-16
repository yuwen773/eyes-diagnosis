"""Loopback-only ticket 04 fixture; synthetic identity, isolated SQLite."""

from contextlib import asynccontextmanager
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from web.tests.workflow_binding_ui_server import app, DIRECTORY
from web.chat.models import LegacyUpload
from web.workflow.models import Workflow, Job

original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    async with original_lifespan(application):
        engine = create_engine(f"sqlite:///{DIRECTORY / 'chat.db'}")
        try:
            with Session(engine) as db:
                if db.get(Workflow, "java-wait") is None:
                    db.add(Workflow(workflow_id="java-wait", owner_user_id=7, idempotency_key="java-key",
                                    status="WAITING_HUMAN_REVIEW", graph_version="java-release",
                                    graph_hash="old-hash", action_version="old-action",
                                    created_at=datetime(2025, 1, 2, 3, 4, 5)))
                    db.add(Job(job_id="java-job", workflow_id="java-wait", job_type="RESUME", segment_code="java"))
                    db.add(LegacyUpload(id=1, task_id="java-upload", user_id=7,
                                        object_key="missing-private-object", status=0))
                    db.commit()
            yield
        finally:
            engine.dispose()


app.router.lifespan_context = lifespan

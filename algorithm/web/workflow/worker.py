"""Production worker: python -m web.workflow.worker [--once].

One durable job advances one Graph-selected segment. No clinical routing table
or model/tool call belongs here. The graph runs outside database transactions.
"""

import argparse
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import DateTime, and_, func, literal_column, or_, select

from web.workflow.checkpoint import MysqlCheckpointSaver, checkpoint_config
from web.workflow.definition import ACTION_VERSION, GRAPH_HASH, GRAPH_VERSION, build_graph
from web.workflow.models import PYTHON_SEGMENT_CODE, Job, UploadInput, Workflow, WorkflowEvent

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Claim:
    job_id: str
    workflow_id: str
    token: str
    lease_version: int
    workflow_version: int
    checkpoint_id: str | None
    image_bytes: bytes
    compatible: bool
    exhausted: bool


def database_now(db) -> datetime:
    # MySQL controls lease time. SQLite is only an engineering-test adapter.
    if db.bind.dialect.name == "mysql":
        return db.scalar(select(literal_column("CURRENT_TIMESTAMP(6)", type_=DateTime())))
    return db.scalar(select(func.current_timestamp()))


def append_event(db, workflow: Workflow, actor_id: str, now: datetime) -> None:
    db.add(WorkflowEvent(event_id=uuid4().hex, workflow_id=workflow.workflow_id,
                         sequence=workflow.version + 1, event_type=workflow.status,
                         actor_type="WORKER", actor_id=actor_id, version=workflow.version,
                         segment=workflow.segment, reason=workflow.stop_reason, occurred_at=now))


class Worker:
    def __init__(self, sessions, *, lease_seconds: int = 30):
        self.sessions = sessions
        self.lease_seconds = lease_seconds
        self.worker_id = uuid4().hex

    def claim(self) -> Claim | None:
        with self.sessions.begin() as db:
            now = database_now(db)
            job = db.scalar(select(Job).where(Job.segment_code == PYTHON_SEGMENT_CODE, or_(
                and_(Job.status.in_(["READY", "RETRY_WAIT"]), Job.available_at <= now),
                and_(Job.status == "RUNNING", Job.lease_until <= now),
            )).order_by(Job.available_at, Job.job_id).limit(1).with_for_update(skip_locked=True))
            if job is None:
                return None
            workflow = db.scalar(select(Workflow).where(
                Workflow.workflow_id == job.workflow_id).with_for_update())
            upload = db.get(UploadInput, job.workflow_id)
            assert workflow is not None and upload is not None
            exhausted = job.attempt >= job.max_attempts
            job.attempt += 1
            job.status, job.lease_owner, job.lease_token = "RUNNING", self.worker_id, uuid4().hex
            job.lease_version += 1
            job.lease_until = now + timedelta(seconds=self.lease_seconds)
            job.updated_at = now
            workflow.status = "RUNNING"
            workflow.version += 1
            workflow.updated_at = now
            append_event(db, workflow, self.worker_id, now)
            return Claim(job.job_id, workflow.workflow_id, job.lease_token,
                         job.lease_version, workflow.version, upload.checkpoint_id,
                         upload.image_bytes,
                         (workflow.graph_version, workflow.graph_hash, workflow.action_version) ==
                         (GRAPH_VERSION, GRAPH_HASH, ACTION_VERSION), exhausted)

    def _owned_rows(self, db, claim: Claim):
        job = db.scalar(select(Job).where(Job.job_id == claim.job_id).with_for_update())
        workflow = db.scalar(select(Workflow).where(
            Workflow.workflow_id == claim.workflow_id).with_for_update())
        now = database_now(db)
        if (job is None or workflow is None or job.status != "RUNNING" or
                job.lease_token != claim.token or job.lease_version != claim.lease_version or
                job.lease_until is None or job.lease_until <= now or
                workflow.version != claim.workflow_version):
            return None
        return job, workflow, now

    def _failure(self, claim: Claim, reason: str, *, permanent: bool = False) -> None:
        with self.sessions.begin() as db:
            owned = self._owned_rows(db, claim)
            if owned is None:
                return
            job, workflow, now = owned
            job.last_error, job.lease_until, job.updated_at = reason, None, now
            if permanent or job.attempt >= job.max_attempts:
                job.status, workflow.status, workflow.stop_reason = "FAILED", "FAILED", reason
            else:
                job.status, workflow.status = "RETRY_WAIT", "QUEUED"
                job.available_at = now + timedelta(seconds=2 ** job.attempt)
            workflow.version += 1
            workflow.updated_at = now
            append_event(db, workflow, self.worker_id, now)

    def run_once(self) -> bool:
        claim = self.claim()
        if claim is None:
            return False
        if not claim.compatible or claim.exhausted:
            self._failure(claim, "GRAPH_VERSION_INCOMPATIBLE" if not claim.compatible
                          else "RETRY_EXHAUSTED", permanent=True)
            return True
        saver = MysqlCheckpointSaver(self.sessions)
        graph = build_graph(saver, claim.image_bytes)
        config = checkpoint_config(claim.workflow_id, "", claim.checkpoint_id or "")
        try:
            if claim.checkpoint_id and saver.get_tuple(config) is None:
                self._failure(claim, "CHECKPOINT_UNAVAILABLE", permanent=True)
                return True
            graph.invoke(None if claim.checkpoint_id else {
                "workflow_id": claim.workflow_id, "status": "RUNNING", "reason": None,
                "completed": [],
            }, config, durability="sync")
            # Public Graph API is the only source of continuation and next node.
            snapshot = graph.get_state({"configurable": {"thread_id": claim.workflow_id}})
            with self.sessions.begin() as db:
                owned = self._owned_rows(db, claim)
                if owned is None:
                    return True
                job, workflow, now = owned
                upload = db.get(UploadInput, claim.workflow_id)
                assert upload is not None
                saver.flush(db)
                checkpoint_id = snapshot.config["configurable"]["checkpoint_id"]
                upload.checkpoint_id = checkpoint_id
                upload.completed_nodes = json.dumps(snapshot.values["completed"])
                workflow.status = snapshot.values["status"]
                workflow.stop_reason = snapshot.values["reason"]
                workflow.segment = snapshot.next[0] if snapshot.next else snapshot.values["completed"][-1]
                workflow.version += 1
                workflow.updated_at = now
                job.status, job.lease_until, job.updated_at = "COMPLETED", None, now
                job.checkpoint_id = checkpoint_id
                if snapshot.next:
                    db.add(Job(job_id=uuid4().hex, workflow_id=claim.workflow_id,
                               job_type="RESUME", epoch=job.epoch + 1,
                               thread_id=claim.workflow_id, checkpoint_id=checkpoint_id,
                               available_at=now, created_at=now, updated_at=now))
                append_event(db, workflow, self.worker_id, now)
            logger.info("workflow=%s segment committed", claim.workflow_id)
        except Exception:
            logger.error("workflow=%s segment failed", claim.workflow_id, exc_info=True)
            self._failure(claim, "EXECUTION_FAILED")
        return True


def main() -> None:
    from web.config import WebConfig
    from web.db import dispose_engine, get_session_factory, init_engine

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Process at most one durable segment")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    init_engine(WebConfig.from_env())
    worker = Worker(get_session_factory())
    try:
        while True:
            worked = worker.run_once()
            if args.once:
                break
            if not worked:
                time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        dispose_engine()


if __name__ == "__main__":
    main()

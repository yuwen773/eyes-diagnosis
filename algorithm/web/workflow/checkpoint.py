"""MySQL LangGraph saver with segment-scoped staging and an atomic commit.

LangGraph can emit checkpoints from background threads. Stage only this segment's
writes, then flush them in the fenced business transaction. Reads always start at
the business row's committed token; a new process needs no in-memory state.
"""

import json
from collections.abc import Iterator, Sequence
from threading import Lock
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple,
    ChannelVersions, WRITES_IDX_MAP,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from web.workflow.models import GraphCheckpoint, GraphWrite


def checkpoint_config(thread: str, namespace: str, checkpoint_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": thread, "checkpoint_ns": namespace,
                             "checkpoint_id": checkpoint_id}}


class MysqlCheckpointSaver(BaseCheckpointSaver):
    def __init__(self, sessions):
        super().__init__()
        self.sessions = sessions
        self.checkpoints: dict[tuple, GraphCheckpoint] = {}
        self.writes: dict[tuple, GraphWrite] = {}
        self.lock = Lock()

    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        settings = config["configurable"]
        thread, namespace = settings["thread_id"], settings.get("checkpoint_ns", "")
        checkpoint_id = settings.get("checkpoint_id")
        with self.sessions() as db:
            if checkpoint_id:
                key = (thread, namespace, checkpoint_id)
                row = self.checkpoints.get(key) or db.get(GraphCheckpoint, key)
            else:
                row = db.scalar(select(GraphCheckpoint).where(
                    GraphCheckpoint.thread_id == thread, GraphCheckpoint.namespace == namespace
                ).order_by(GraphCheckpoint.checkpoint_id.desc()).limit(1))
                staged = [r for r in self.checkpoints.values()
                          if r.thread_id == thread and r.namespace == namespace]
                if staged:
                    latest = max(staged, key=lambda r: r.checkpoint_id)
                    if row is None or latest.checkpoint_id > row.checkpoint_id:
                        row = latest
            if row is None:
                return None
            pending = list(db.scalars(select(GraphWrite).where(
                GraphWrite.thread_id == thread, GraphWrite.namespace == namespace,
                GraphWrite.checkpoint_id == row.checkpoint_id,
            ).order_by(GraphWrite.task_id, GraphWrite.index)))
            overlay = {(w.task_id, w.index): w for w in pending}
            overlay.update({(w.task_id, w.index): w for w in self.writes.values()
                            if (w.thread_id, w.namespace, w.checkpoint_id) ==
                            (thread, namespace, row.checkpoint_id)})
            return CheckpointTuple(
                config=checkpoint_config(thread, namespace, row.checkpoint_id),
                checkpoint=self.serde.loads_typed((row.value_type, row.value)),
                metadata=json.loads(row.metadata_json),
                parent_config=checkpoint_config(thread, namespace, row.parent_id)
                if row.parent_id else None,
                pending_writes=[(w.task_id, w.channel, self.serde.loads_typed((w.value_type, w.value)))
                                for w in overlay.values()],
            )

    def put(self, config: RunnableConfig, checkpoint: Checkpoint,
            metadata: CheckpointMetadata, new_versions: ChannelVersions) -> RunnableConfig:
        settings = config["configurable"]
        thread, namespace = settings["thread_id"], settings.get("checkpoint_ns", "")
        value_type, value = self.serde.dumps_typed(checkpoint)
        row = GraphCheckpoint(thread_id=thread, namespace=namespace,
                              checkpoint_id=checkpoint["id"],
                              parent_id=settings.get("checkpoint_id"), value_type=value_type,
                              value=value, metadata_json=json.dumps(metadata))
        with self.lock:
            self.checkpoints[(thread, namespace, checkpoint["id"])] = row
        return checkpoint_config(thread, namespace, checkpoint["id"])

    def put_writes(self, config: RunnableConfig, writes: Sequence[tuple[str, Any]],
                   task_id: str, task_path: str = "") -> None:
        settings = config["configurable"]
        thread, namespace = settings["thread_id"], settings.get("checkpoint_ns", "")
        for index, (channel, value) in enumerate(writes):
            write_index = WRITES_IDX_MAP.get(channel, index)
            value_type, encoded = self.serde.dumps_typed(value)
            key = (thread, namespace, settings["checkpoint_id"], task_id, write_index)
            row = GraphWrite(thread_id=thread, namespace=namespace,
                             checkpoint_id=settings["checkpoint_id"], task_id=task_id,
                             index=write_index, channel=channel, value_type=value_type, value=encoded)
            with self.lock:
                if write_index < 0 or key not in self.writes:
                    self.writes[key] = row

    def flush(self, db: Session) -> None:
        """Caller holds the job/workflow locks and has checked lease + version."""
        for checkpoint_row in self.checkpoints.values():
            db.add(checkpoint_row)
        for key, row in self.writes.items():
            existing = db.get(GraphWrite, key)
            if existing is None:
                db.add(row)
            elif row.index < 0:
                existing.channel, existing.value_type, existing.value = row.channel, row.value_type, row.value

    def list(self, config: RunnableConfig | None, *, filter: dict[str, Any] | None = None,
             before: RunnableConfig | None = None, limit: int | None = None) -> Iterator[CheckpointTuple]:
        with self.sessions() as db:
            query = select(GraphCheckpoint)
            if config:
                settings = config["configurable"]
                query = query.where(GraphCheckpoint.thread_id == settings["thread_id"],
                                    GraphCheckpoint.namespace == settings.get("checkpoint_ns", ""))
            if before:
                query = query.where(GraphCheckpoint.checkpoint_id < before["configurable"]["checkpoint_id"])
            rows = list(db.scalars(query.order_by(GraphCheckpoint.checkpoint_id.desc())))
            configs = [checkpoint_config(r.thread_id, r.namespace, r.checkpoint_id) for r in rows
                       if not filter or all(json.loads(r.metadata_json).get(k) == v for k, v in filter.items())]
        for item in configs[:limit]:
            saved = self.get_tuple(item)
            if saved:
                yield saved

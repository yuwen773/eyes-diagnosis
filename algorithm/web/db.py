"""SQLAlchemy engine, session factory and primary-key generation.

Schema ownership
----------------
Flyway remains the sole authority for DDL (``src/main/resources/db/migration/``,
V1-V9). This module never issues DDL -- it only reads and writes rows in the
schema Flyway already created. Alembic is deliberately absent: adding a second
migration authority for the same database is how schemas drift.

Column naming
-------------
Columns are **camelCase**, matching the Java entities one-for-one. This is not
a style choice: ``application.yml`` sets
``mybatis-plus.configuration.map-underscore-to-camel-case: false``, so MyBatis
Plus maps ``userAccount -> userAccount`` literally. Renaming columns to snake_case
in Python would break every join against the existing rows.

Primary keys
------------
Two strategies coexist in the Java entities, and both must be honoured:

* ``IdType.ASSIGN_ID`` -- Snowflake, client-side. Used by ``User``,
  ``Diagnosis``, ``News``, ``AgentSession``, ``AgentMessage``,
  ``Chatsession``, ``UploadTask``, ``InferenceCache``.
* ``IdType.AUTO`` -- MySQL ``AUTO_INCREMENT``. Used by ``ChatHistory``,
  ``KnowledgeDocument``, ``McpServer``.

Snowflake parity
----------------
``SnowflakeIdGenerator`` reproduces ``com.baomidou.mybatisplus.core.toolkit.Sequence``
exactly: epoch ``1288834974657`` and the 41/5/5/12 bit layout

    id = ((timestamp - epoch) << 22) | (datacenterId << 17) | (workerId << 12) | sequence

so Python-generated IDs are the same magnitude (19 digits) and monotonic in
wall-clock time as the Java ones. Byte-identical values are not required --
uniqueness is -- and are not achievable anyway: Java auto-derives
``datacenterId`` from the NIC MAC address and ``workerId`` from
``(datacenterId + PID) % 32`` unless ``mybatis-plus.global-config.worker-id`` /
``datacenter-id`` is set, which this project never sets. Python instead takes
explicitly configured ids, so the two services must be given *different*
worker ids to stay safe if they ever run on the same host.

Logical delete
--------------
``isDelete TINYINT`` is a MyBatis Plus logical-delete field (``application.yml``
sets ``global-config.db-config.logic-delete-field: isDelete``). SQLAlchemy has
no equivalent, so models use ``is_delete = Column(...)`` and queries filter
explicitly via :func:`not_deleted`. Note the Java field is ``isDelete`` in the
entity but ``is_delete`` in the Python attribute -- the *column* stays
``isDelete``.

Agent-owned tables (``t_agent_session``, ``t_agent_message``, ``t_chat_session``,
``t_chat_history``, ``t_upload_task``) are deliberately NOT modelled here: they
belong to the Agent subsystem, which stays on Java.

``t_inference_cache`` is **not** in that list, contrary to an earlier draft of
this comment. It is written only by ``DiagnosisServiceImpl.java:183,198`` via
``InferenceCacheMapper``, so it migrates with the diagnosis domain in Phase 2.2
and gets an ORM class there.
"""

import threading
import time

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from web.config import WebConfig


class Base(DeclarativeBase):
    """Declarative base for all migrating-domain tables."""


# --- Snowflake ----------------------------------------------------------------

#: ``com.baomidou.mybatisplus.core.toolkit.Sequence#twepoch`` (2010-11-04 09:42:54.657 UTC).
MP_TWEPOCH = 1288834974657

_WORKER_ID_BITS = 5
_DATACENTER_ID_BITS = 5
_SEQUENCE_BITS = 12

_MAX_WORKER_ID = (1 << _WORKER_ID_BITS) - 1  # 31
_MAX_DATACENTER_ID = (1 << _DATACENTER_ID_BITS) - 1  # 31
_SEQUENCE_MASK = (1 << _SEQUENCE_BITS) - 1  # 4095
_TIMESTAMP_SHIFT = _SEQUENCE_BITS + _WORKER_ID_BITS + _DATACENTER_ID_BITS  # 22


class SnowflakeIdGenerator:
    """Client-side Snowflake generator matching MyBatis Plus ``Sequence``.

    Single-process use: the web layer runs as one Uvicorn worker, so instance
    state (no cross-process coordination) is sufficient. Starting multiple
    workers requires giving each a distinct ``worker_id``.

    MyBatis Plus throws when the clock moves backwards by more than 5 ms. That
    guard is preserved -- silently reissuing IDs from a rewound clock is how
    snowflake implementations produce duplicates.
    """

    def __init__(self, worker_id: int = 0, datacenter_id: int = 0, epoch: int = MP_TWEPOCH):
        if not 0 <= worker_id <= _MAX_WORKER_ID:
            raise ValueError(f"worker_id must be 0..{_MAX_WORKER_ID}, got {worker_id!r}")
        if not 0 <= datacenter_id <= _MAX_DATACENTER_ID:
            raise ValueError(f"datacenter_id must be 0..{_MAX_DATACENTER_ID}, got {datacenter_id!r}")
        self.worker_id = worker_id
        self.datacenter_id = datacenter_id
        self.epoch = epoch
        self._sequence = 0
        self._last_timestamp = -1
        self._lock = threading.Lock()

    def next_id(self) -> int:
        with self._lock:
            timestamp = self._now()

            if timestamp < self._last_timestamp:
                offset = self._last_timestamp - timestamp
                if offset > 5:
                    raise RuntimeError(
                        f"clock moved backwards by {offset}ms; refusing to generate an id "
                        f"(matches MyBatis Plus Sequence's 5ms tolerance)"
                    )
                # Within tolerance: busy-wait for the clock to catch up.
                timestamp = self._last_timestamp

            if timestamp == self._last_timestamp:
                self._sequence = (self._sequence + 1) & _SEQUENCE_MASK
                if self._sequence == 0:
                    # Sequence exhausted within one millisecond -- spin to the
                    # next millisecond rather than reuse the sequence space.
                    timestamp = self._spin_until_next_ms(self._last_timestamp)
            else:
                # MyBatis Plus starts a new millisecond's sequence at a random
                # 1 or 2 rather than 0, to discourage sequential-ID guessing.
                # Reproduced here for parity.
                self._sequence = 1 if (timestamp & 1) == 0 else 2

            self._last_timestamp = timestamp

            return (
                ((timestamp - self.epoch) << _TIMESTAMP_SHIFT)
                | (self.datacenter_id << (_SEQUENCE_BITS + _WORKER_ID_BITS))
                | (self.worker_id << _SEQUENCE_BITS)
                | self._sequence
            )

    @staticmethod
    def _now() -> int:
        return int(time.time() * 1000)

    def _spin_until_next_ms(self, last: int) -> int:
        timestamp = self._now()
        while timestamp <= last:
            timestamp = self._now()
        return timestamp


#: Process-wide generator. ``t_user``/``t_diagnosis``/``t_news`` rows use it.
id_generator = SnowflakeIdGenerator()


# --- Engine / session ---------------------------------------------------------

_engine = None
_SessionLocal = None


def init_engine(config: WebConfig) -> None:
    """Create the engine. Idempotent -- called once from the app lifespan."""
    global _engine, _SessionLocal
    if _engine is not None:
        return
    _engine = create_engine(
        config.mysql_url,
        pool_pre_ping=True,
        pool_recycle=3600,
        # MySQL DATETIME has no timezone. Returning naive datetimes keeps them
        # identical to what Java reads; converting to UTC-aware would shift
        # every timestamp in the database.
        connect_args={"init_command": "SET time_zone = '+08:00'"},
        future=True,
    )
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def get_engine():
    if _engine is None:
        raise RuntimeError("engine not initialized; call init_engine() from the app lifespan")
    return _engine


def get_session_factory():
    if _SessionLocal is None:
        raise RuntimeError("session factory not initialized; call init_engine() first")
    return _SessionLocal


def dispose_engine() -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None

"""``t_inference_cache`` -- diagnosis domain (Phase 2.2).

Not an Agent table. It is written **only** by ``DiagnosisServiceImpl`` (:183
lookup, :198 upsert) via ``InferenceCacheMapper``, so it migrates with the
diagnosis domain. An earlier Phase 1 comment misfiled it as Agent-owned; see
ruling 12 in ``docs/migration-decisions.md``.

Primary key
-----------
The DDL says ``AUTO_INCREMENT`` but ``InferenceCache.java:12`` declares
``@TableId(type = IdType.ASSIGN_ID)`` -- MyBatis Plus assigns a Snowflake id
*before* the INSERT. The entity wins: this column gets a Snowflake id from
``web.db.id_generator``, consistent with the other migrated tables.

Unique key
----------
``uk_inference`` is 5 columns, arrived at over three migrations (V2 -> 3 cols,
V7 -> 4 cols, V9 -> 5 cols). V9 back-filled existing rows with
``inferencePolicyVersion = 'legacy-unknown'`` precisely so they could not be
reused -- a row whose policy version is unknown must never be served as a hit.

Write semantics
---------------
``InferenceCacheMapper.xml:53`` uses ``INSERT ... ON DUPLICATE KEY UPDATE id =
id``: a no-op update that swallows duplicate-key errors. It is
**insert-only-if-absent** -- a stale row is never refreshed and ``createTime``
is never bumped. A Python port must not "improve" this into an upsert that
overwrites, which would change which response a repeated image gets.
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Double, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from web.db import Base

#: The 5-tuple in DDL order. Also the tuple Java hashes/normalises against in
#: ``InferenceCacheMapper.xml:34``.
CACHE_KEY_COLUMNS = (
    "imageHash",
    "modelVersion",
    "weightSha256",
    "preprocessVersion",
    "inferencePolicyVersion",
)


class InferenceCache(Base):
    __tablename__ = "t_inference_cache"

    #: ``uk_inference`` from the V9 migration. Declared so the ORM, SQLite tests
    #: and MySQL agree on what "already cached" means -- without it a second
    #: write of the same 5-tuple would silently succeed and the "insert-only"
    #: contract of ``ON DUPLICATE KEY UPDATE id = id`` would be untestable.
    __table_args__ = (UniqueConstraint(*CACHE_KEY_COLUMNS, name="uk_inference"),)

    id: Mapped[int] = mapped_column("id", BigInteger, primary_key=True)

    # --- cache key (uk_inference) ---
    #: SHA-256 hex of the raw image bytes, lowercase. Matches Java's
    #: ``sha256Hex`` (:295-307), which formats byte-by-byte with ``%02x`` --
    #: byte-identical to ``hashlib.sha256(b).hexdigest()``.
    image_hash: Mapped[str] = mapped_column("imageHash", String(64), nullable=False)
    model_version: Mapped[str] = mapped_column("modelVersion", String(64), nullable=False)
    #: Java normalises to lowercase before use (:309-311); MySQL's
    #: case-insensitive collation makes this belt-and-braces, but the
    #: comparison is done in Python too, so it must be preserved.
    weight_sha256: Mapped[str] = mapped_column("weightSha256", String(64), nullable=False)
    preprocess_version: Mapped[str] = mapped_column(
        "preprocessVersion", String(64), nullable=False
    )
    inference_policy_version: Mapped[str] = mapped_column(
        "inferencePolicyVersion", String(64), nullable=False
    )

    # --- response payload ---
    predicted_label: Mapped[str] = mapped_column("predictedLabel", String(64), nullable=False)
    probability: Mapped[float] = mapped_column("probability", Double, nullable=False)
    #: 0 (not null) when uncalibrated -- the column is NOT NULL with DEFAULT 0.
    #: Java distinguishes "0.0" from "absent" via ``calibrationStatus``, so the
    #: zero is never read as a real probability.
    calibrated_probability: Mapped[float] = mapped_column(
        "calibratedProbability", Double, nullable=False, default=0
    )
    #: Only two values are ever accepted: ``CALIBRATED`` / ``NOT_CALIBRATED``.
    #: ``grpc_server.py:74`` rejects anything else at startup.
    calibration_status: Mapped[str] = mapped_column(
        "calibrationStatus", String(32), nullable=False, default="NOT_CALIBRATED"
    )
    description: Mapped[str | None] = mapped_column("description", String(512))
    reliability_score: Mapped[int] = mapped_column("reliabilityScore", Integer, nullable=False)
    #: JSON array of ``{"label": str, "probability": float}``. Stored as a JSON
    #: string; Java's serialise path throws ``IllegalStateException`` on failure
    #: (:357) and its parse path throws too (:400) -- neither degrades silently.
    top_predictions: Mapped[str | None] = mapped_column("topPredictions", Text)
    quality_score: Mapped[int] = mapped_column("qualityScore", Integer, nullable=False, default=0)
    #: Comma-separated reason codes from ``eye_diagnosis.quality.evaluate_quality``.
    quality_reasons: Mapped[str | None] = mapped_column("qualityReasons", String(512))
    #: TINYINT. Read back through ``Boolean.TRUE.equals(...)`` in Java (:385) so
    #: a NULL degrades to false rather than throwing -- Python must use
    #: ``is True``-style truthiness, not truthy-on-string.
    is_ood: Mapped[int] = mapped_column("isOod", Integer, nullable=False, default=0)
    ood_score: Mapped[float] = mapped_column("oodScore", Double, nullable=False, default=0)
    #: The proto enum **name** (:240), not its number. Read back through
    #: ``parseOodStatus`` which falls back to ``NOT_EVALUATED`` on anything
    #: unrecognised (:405-411) -- a lowercase DB value degrades silently.
    ood_status: Mapped[str] = mapped_column(
        "oodStatus", String(32), nullable=False, default="NOT_EVALUATED"
    )
    rejected: Mapped[int] = mapped_column("rejected", Integer, nullable=False, default=0)
    abstain_reason: Mapped[str | None] = mapped_column("abstainReason", String(64))
    requires_review: Mapped[int] = mapped_column(
        "requiresReview", Integer, nullable=False, default=0
    )
    create_time: Mapped[datetime | None] = mapped_column("createTime", DateTime)
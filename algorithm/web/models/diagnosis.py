"""``t_diagnosis`` -- diagnosis domain (Phase 2.2).

Mirrors ``model/entity/Diagnosis.java``. The V5 ``medical_reliability`` and V7
inference-safety migrations added the reliability columns; they are part of the
row contract the frontend reads, so they are mapped here rather than treated as
an opaque blob.

``severity`` is a free-text column, but the Java service only ever writes the
constant ``"NOT_ASSESSED"`` (``DiagnosisServiceImpl.java:445``). The Chinese
values ``'低'``/``'中'``/``'高'`` are a **dead frontend branch**
(``DiagnosisReportDetail.vue:244-260``), not a real contract -- see ruling 14
in ``docs/migration-decisions.md``.

Deliberately **not** mapped: the ``image_hash`` column (``schema.sql:181``,
indexed at :182). It exists in the DDL with no entity field on the Java side
either -- cache lookup moved to ``t_inference_cache``. Mapping it would imply
Java behaviour that does not exist.
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Double, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from web.db import Base


class Diagnosis(Base):
    __tablename__ = "t_diagnosis"

    id: Mapped[int] = mapped_column("id", BigInteger, primary_key=True)
    url: Mapped[str] = mapped_column("url", String(512), nullable=False)
    user_id: Mapped[int] = mapped_column("userId", BigInteger, nullable=False)
    result: Mapped[str | None] = mapped_column("result", String(64))
    confidence: Mapped[float | None] = mapped_column("confidence", Double)
    #: Added by the post-``schema.sql`` ``ALTER TABLE`` in db/schema.sql.
    probability: Mapped[float | None] = mapped_column("probability", Double)
    #: Newline-separated string, NOT a JSON array -- the frontend splits it.
    recommendations: Mapped[str | None] = mapped_column("recommendations", String(512))
    details: Mapped[str | None] = mapped_column("details", String(512))
    severity: Mapped[str | None] = mapped_column("severity", String(64))
    #: Legacy review flag, distinct from the V5 ``humanReviewStatus`` enum.
    #: ``ReexamineConstant``: 1 undone / 2 waiting / 3 done. The DDL default is
    #: **1**, not 0 -- 0 is not a defined state, and an earlier draft of this
    #: model used ``default=0``, which would have made every new diagnosis
    #: unrecognisable to any status filter.
    reexamine_status: Mapped[int] = mapped_column("reexamineStatus", Integer, default=1)

    pic_size: Mapped[int | None] = mapped_column("picSize", BigInteger)
    pic_width: Mapped[int | None] = mapped_column("picWidth", Integer)
    pic_height: Mapped[int | None] = mapped_column("picHeight", Integer)
    pic_scale: Mapped[float | None] = mapped_column("picScale", Double)
    pic_format: Mapped[str | None] = mapped_column("picFormat", String(32))

    create_time: Mapped[datetime] = mapped_column("createTime", DateTime, nullable=False)
    is_delete: Mapped[int] = mapped_column("isDelete", Integer, nullable=False, default=0)

    # --- V5 medical_reliability ---
    ai_rejected: Mapped[bool | None] = mapped_column("aiRejected", Integer)
    abstain_reason: Mapped[str | None] = mapped_column("abstainReason", String(40))
    model_version: Mapped[str | None] = mapped_column("modelVersion", String(64))
    weight_sha256: Mapped[str | None] = mapped_column("weightSha256", String(128))
    #: PENDING_AI / AI_ONLY / AWAITING_REVIEW / REVIEWED / OVERRIDDEN
    human_review_status: Mapped[str | None] = mapped_column(
        "humanReviewStatus", String(20), default="PENDING_AI"
    )
    human_reviewer_id: Mapped[int | None] = mapped_column("humanReviewerId", BigInteger)
    human_reviewed_at: Mapped[datetime | None] = mapped_column("humanReviewedAt", DateTime)
    human_review_note: Mapped[str | None] = mapped_column("humanReviewNote", Text)
    human_result: Mapped[str | None] = mapped_column("humanResult", String(255))
    human_severity: Mapped[str | None] = mapped_column("humanSeverity", String(40))
    human_recommendations: Mapped[str | None] = mapped_column("humanRecommendations", Text)

    # --- V7 inference safety policy ---
    preprocess_version: Mapped[str | None] = mapped_column("preprocessVersion", String(64))
    inference_policy_version: Mapped[str | None] = mapped_column(
        "inferencePolicyVersion", String(64)
    )
    calibration_status: Mapped[str | None] = mapped_column("calibrationStatus", String(32))
    #: Only meaningful when ``calibration_status == 'CALIBRATED'``.
    calibrated_probability: Mapped[float | None] = mapped_column("calibratedProbability", Double)
    quality_score: Mapped[int | None] = mapped_column("qualityScore", Integer)
    quality_reasons: Mapped[str | None] = mapped_column("qualityReasons", String(512))
    ood_status: Mapped[str | None] = mapped_column("oodStatus", String(32))
    #: A null ``ood_score`` means "not assessed", which is NOT the same as in-distribution.
    ood_score: Mapped[float | None] = mapped_column("oodScore", Float)

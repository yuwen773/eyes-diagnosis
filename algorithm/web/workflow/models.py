"""Release V10/V11 workflow semantics, plus V15 upload/checkpoint storage."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from web.db import Base

PYTHON_SEGMENT_CODE = "python-graph"


class Workflow(Base):
    __tablename__ = "t_diagnosis_workflow"
    __table_args__ = (UniqueConstraint("ownerUserId", "creationIdempotencyKey"),)

    workflow_id: Mapped[str] = mapped_column("workflowId", String(64), primary_key=True)
    owner_user_id: Mapped[int] = mapped_column("ownerUserId", BigInteger)
    idempotency_key: Mapped[str] = mapped_column("creationIdempotencyKey", String(128))
    status: Mapped[str] = mapped_column(String(48))
    segment: Mapped[str | None] = mapped_column("currentSegmentCode", String(64))
    graph_version: Mapped[str] = mapped_column("graphDefinitionVersion", String(64))
    graph_hash: Mapped[str] = mapped_column("graphDefinitionHash", String(128))
    action_version: Mapped[str] = mapped_column("actionVersion", String(64))
    version: Mapped[int] = mapped_column("workflowVersion", BigInteger, default=0)
    inference_epoch: Mapped[int] = mapped_column("inferenceEpoch", BigInteger, default=0)
    inference_envelope_id: Mapped[str | None] = mapped_column("inferenceEnvelopeId", String(64))
    publication_status: Mapped[str] = mapped_column("explanationPublicationStatus", String(32), default="NONE")
    exposure_status: Mapped[str] = mapped_column("predictionExposureStatus", String(48), default="HIDDEN")
    stop_reason: Mapped[str | None] = mapped_column("stopReasonCode", String(64))
    limitation_reason: Mapped[str | None] = mapped_column("limitationReasonCode", String(64))
    question: Mapped[str | None] = mapped_column("questionText", Text)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime, default=func.now())


class UploadInput(Base):
    __tablename__ = "t_workflow_upload_input"

    workflow_id: Mapped[str] = mapped_column("workflowId", String(64), primary_key=True)
    request_digest: Mapped[str] = mapped_column("requestDigest", String(64))
    image_bytes: Mapped[bytes] = mapped_column("imageBytes", LargeBinary)
    checkpoint_id: Mapped[str | None] = mapped_column("graphCheckpointId", String(128))
    completed_nodes: Mapped[str] = mapped_column("completedNodes", Text, default="[]")


class InferenceEnvelopeRow(Base):
    """V11 immutable snapshot. Writers insert; committed epochs are never updated."""

    __tablename__ = "t_inference_envelope"
    __table_args__ = (UniqueConstraint("workflowId", "inferenceEpoch"),)

    envelope_id: Mapped[str] = mapped_column("inferenceEnvelopeId", String(64), primary_key=True)
    workflow_id: Mapped[str] = mapped_column("workflowId", String(64))
    inference_epoch: Mapped[int] = mapped_column("inferenceEpoch", BigInteger)
    image_reference: Mapped[str] = mapped_column("imageObjectReference", String(512))
    input_digest: Mapped[str] = mapped_column("inputDigest", String(128))
    media_type: Mapped[str] = mapped_column("detectedMediaType", String(128))
    quality_outcome: Mapped[str] = mapped_column("qualityOutcome", String(32))
    quality_score: Mapped[int] = mapped_column("qualityScore", Integer)
    quality_reasons: Mapped[str] = mapped_column("qualityReasonCodesSnapshot", Text)
    outcome: Mapped[str] = mapped_column("inferenceOutcomeType", String(32))
    prediction_snapshot: Mapped[str | None] = mapped_column("predictionSnapshot", Text)
    confidence_snapshot: Mapped[str | None] = mapped_column("confidenceSnapshot", Text)
    abstention_reason: Mapped[str | None] = mapped_column("safetyAbstentionReasonCode", String(64))
    failure_code: Mapped[str | None] = mapped_column("technicalFailureCode", String(64))
    ood_snapshot: Mapped[str] = mapped_column("oodSnapshot", Text)
    calibration_snapshot: Mapped[str] = mapped_column("calibrationSnapshot", Text)
    model_version: Mapped[str] = mapped_column("modelVersion", String(128))
    model_fingerprint: Mapped[str] = mapped_column("modelWeightFingerprint", String(128))
    preprocess_version: Mapped[str] = mapped_column("preprocessVersion", String(128))
    policy_version: Mapped[str] = mapped_column("inferencePolicyVersion", String(128))
    inferred_at: Mapped[datetime] = mapped_column("inferredAt", DateTime)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, default=func.now())


class Job(Base):
    __tablename__ = "t_workflow_job"
    __table_args__ = (UniqueConstraint("workflowId", "executionEpoch", "segmentCode", "jobType"),)

    job_id: Mapped[str] = mapped_column("jobId", String(64), primary_key=True)
    workflow_id: Mapped[str] = mapped_column("workflowId", String(64))
    job_type: Mapped[str] = mapped_column("jobType", String(32))
    segment_code: Mapped[str] = mapped_column("segmentCode", String(64), default=PYTHON_SEGMENT_CODE)
    epoch: Mapped[int] = mapped_column("executionEpoch", BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(32), default="READY")
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column("maxAttempts", Integer, default=3)
    available_at: Mapped[datetime] = mapped_column("availableAt", DateTime, default=func.now())
    lease_owner: Mapped[str | None] = mapped_column("leaseOwner", String(128))
    lease_token: Mapped[str | None] = mapped_column("leaseToken", String(128))
    lease_version: Mapped[int] = mapped_column("leaseVersion", BigInteger, default=0)
    lease_until: Mapped[datetime | None] = mapped_column("leaseUntil", DateTime)
    thread_id: Mapped[str | None] = mapped_column("graphThreadId", String(128))
    checkpoint_id: Mapped[str | None] = mapped_column("graphCheckpointId", String(128))
    last_error: Mapped[str | None] = mapped_column("lastErrorCode", String(64))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime, default=func.now())


class WorkflowEvent(Base):
    __tablename__ = "t_diagnosis_workflow_event"
    __table_args__ = (UniqueConstraint("workflowId", "eventSequence"),)

    event_id: Mapped[str] = mapped_column("eventId", String(64), primary_key=True)
    workflow_id: Mapped[str] = mapped_column("workflowId", String(64))
    sequence: Mapped[int] = mapped_column("eventSequence", BigInteger)
    event_type: Mapped[str] = mapped_column("eventType", String(64))
    actor_type: Mapped[str] = mapped_column("actorType", String(32))
    actor_id: Mapped[str | None] = mapped_column("actorId", String(64))
    version: Mapped[int] = mapped_column("workflowVersion", BigInteger)
    segment: Mapped[str | None] = mapped_column("segmentCode", String(64))
    reason: Mapped[str | None] = mapped_column("reasonCode", String(64))
    payload: Mapped[str | None] = mapped_column("payloadSnapshot", Text)
    occurred_at: Mapped[datetime] = mapped_column("occurredAt", DateTime, default=func.now())


class GraphCheckpoint(Base):
    __tablename__ = "t_python_graph_checkpoint"

    thread_id: Mapped[str] = mapped_column("threadId", String(128), primary_key=True)
    namespace: Mapped[str] = mapped_column("checkpointNamespace", String(128), primary_key=True)
    checkpoint_id: Mapped[str] = mapped_column("checkpointId", String(128), primary_key=True)
    parent_id: Mapped[str | None] = mapped_column("parentCheckpointId", String(128))
    value_type: Mapped[str] = mapped_column("valueType", String(32))
    value: Mapped[bytes] = mapped_column("checkpointValue", LargeBinary)
    metadata_json: Mapped[str] = mapped_column("metadataJson", Text)


class GraphWrite(Base):
    __tablename__ = "t_python_graph_write"

    thread_id: Mapped[str] = mapped_column("threadId", String(128), primary_key=True)
    namespace: Mapped[str] = mapped_column("checkpointNamespace", String(128), primary_key=True)
    checkpoint_id: Mapped[str] = mapped_column("checkpointId", String(128), primary_key=True)
    task_id: Mapped[str] = mapped_column("taskId", String(128), primary_key=True)
    index: Mapped[int] = mapped_column("writeIndex", Integer, primary_key=True)
    channel: Mapped[str] = mapped_column(String(128))
    value_type: Mapped[str] = mapped_column("valueType", String(32))
    value: Mapped[bytes] = mapped_column("writeValue", LargeBinary)

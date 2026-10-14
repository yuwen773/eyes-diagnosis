"""User business-write consent, independent of clinical review and graph state."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from web.db import Base


class SaveConfirmation(Base):
    __tablename__ = "t_diagnosis_save_confirmation"
    __table_args__ = (UniqueConstraint("ownerUserId", "idempotencyKey"),
                      UniqueConstraint("workflowId", "requestVersion"))

    confirmation_id: Mapped[str] = mapped_column("confirmationId", String(64), primary_key=True)
    owner_user_id: Mapped[int] = mapped_column("ownerUserId", BigInteger)
    workflow_id: Mapped[str] = mapped_column("workflowId", String(64), index=True)
    operation: Mapped[str] = mapped_column("operationType", String(32))
    idempotency_key: Mapped[str] = mapped_column("idempotencyKey", String(128))
    workflow_version: Mapped[int] = mapped_column("workflowVersion", BigInteger)
    request_version: Mapped[int] = mapped_column("requestVersion", BigInteger)
    content: Mapped[str] = mapped_column("contentSnapshot", Text)
    content_digest: Mapped[str] = mapped_column("contentDigest", String(64))
    status: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime)
    decided_at: Mapped[datetime | None] = mapped_column("decidedAt", DateTime)


class SavedWorkflowDiagnosis(Base):
    __tablename__ = "t_saved_workflow_diagnosis"

    workflow_id: Mapped[str] = mapped_column("workflowId", String(64), primary_key=True)
    diagnosis_id: Mapped[int] = mapped_column("diagnosisId", BigInteger, unique=True)
    confirmation_id: Mapped[str] = mapped_column("confirmationId", String(64), unique=True)

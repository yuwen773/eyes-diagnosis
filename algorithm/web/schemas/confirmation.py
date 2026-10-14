"""Explicit, version-bound consent. Clients cannot supply saved content."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from web.schemas.workflow import PublishedExplanation


class SaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotencyKey: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    expectedWorkflowVersion: str = Field(pattern=r"^(0|[1-9][0-9]{0,18})$")
    expectedExplanationSnapshotId: str = Field(min_length=1, max_length=64)
    expectedExplanationRevision: str = Field(pattern=r"^[1-9][0-9]{0,18}$")


class SaveDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotencyKey: str = Field(min_length=1, max_length=128)
    expectedContentDigest: str = Field(pattern=r"^[a-f0-9]{64}$")
    expectedWorkflowVersion: str = Field(pattern=r"^(0|[1-9][0-9]{0,18})$")


class SaveContent(BaseModel):
    imageUrl: str
    imageDigest: str
    result: str
    calibratedProbability: float
    severity: Literal["NOT_ASSESSED"]
    details: str
    explanation: PublishedExplanation
    finalReviewTaskId: str | None


class SaveConfirmationView(BaseModel):
    confirmationId: str
    workflowId: str
    operationType: Literal["SAVE_DIAGNOSIS"]
    status: Literal["PENDING", "APPROVED", "REJECTED", "EXPIRED", "INVALIDATED"]
    idempotencyKey: str
    workflowVersion: str
    contentDigest: str
    content: SaveContent
    expiresAt: str
    diagnosisId: str | None

"""Doctor quality review is separate from user business-write approval."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ReviewVersions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedTaskVersion: str = Field(pattern=r"^(0|[1-9][0-9]{0,18})$")
    expectedWorkflowVersion: str = Field(pattern=r"^(0|[1-9][0-9]{0,18})$")


class QualityDecision(ReviewVersions):
    decisionCode: Literal["APPROVE_CONTINUE", "REJECT_RESUBMIT"]
    reasonCode: Literal["QUALITY_APPROVED", "QUALITY_REJECTED"]


class ReviewSummary(BaseModel):
    reviewTaskId: str
    workflowId: str
    reviewType: Literal["IMAGE_QUALITY_GATE"]
    status: Literal["OPEN", "CLAIMED", "SUBMITTED"]
    taskVersion: str
    workflowVersion: str
    assignedDoctorId: str | None
    decisionCode: Literal["APPROVE_CONTINUE", "REJECT_RESUBMIT"] | None
    reasonCode: str | None


class ReviewDetail(ReviewSummary):
    question: str
    supplementaryNotes: list[str] = Field(default_factory=list)
    allowedDecisions: list[Literal["APPROVE_CONTINUE", "REJECT_RESUBMIT"]]
    inferenceEnvelopeId: str
    inferenceEpoch: str
    inputDigest: str
    qualityOutcome: str
    qualityScore: int
    qualityReasons: list[str]
    modelVersion: str
    modelWeightFingerprint: str
    preprocessVersion: str
    inferencePolicyVersion: str
    graphDefinitionVersion: str

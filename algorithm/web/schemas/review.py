"""Doctor quality and final review are separate from user business-write approval."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ReviewDecisionCode = Literal["APPROVE_CONTINUE", "REJECT_RESUBMIT", "CONFIRM_AI_ASSESSMENT",
    "CORRECT_AI_ASSESSMENT", "INCONCLUSIVE", "CONFIRM_ABSTENTION", "PROVIDE_INDEPENDENT_REVIEW"]


class ReviewVersions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedTaskVersion: str = Field(pattern=r"^(0|[1-9][0-9]{0,18})$")
    expectedWorkflowVersion: str = Field(pattern=r"^(0|[1-9][0-9]{0,18})$")
    expectedExplanationSnapshotId: str | None = Field(default=None, max_length=64)
    expectedExplanationRevision: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,18}$")


class ReviewSubmission(ReviewVersions):
    decisionCode: ReviewDecisionCode
    reasonCode: Literal["QUALITY_APPROVED", "QUALITY_REJECTED", "AI_ASSESSMENT_CONFIRMED",
        "AI_ASSESSMENT_CORRECTED", "INCONCLUSIVE", "ABSTENTION_CONFIRMED", "INDEPENDENT_REVIEW_PROVIDED"]


class ReviewSummary(BaseModel):
    reviewTaskId: str
    workflowId: str
    reviewType: Literal["IMAGE_QUALITY_GATE", "FINAL_CLINICAL_REVIEW"]
    status: Literal["OPEN", "CLAIMED", "SUBMITTED"]
    taskVersion: str
    workflowVersion: str
    assignedDoctorId: str | None
    decisionCode: ReviewDecisionCode | None
    reasonCode: str | None


class ReviewAuditEntry(BaseModel):
    eventId: str
    eventType: str
    actorType: str
    workflowVersion: str
    reasonCode: str | None
    occurredAt: str


class ReviewDetail(ReviewSummary):
    question: str
    supplementaryNotes: list[str] = Field(default_factory=list)
    allowedDecisions: list[ReviewDecisionCode]
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
    inferenceOutcome: str
    abstentionReason: str | None = None
    modelAssessment: dict | None = None
    evidence: dict | None = None
    explanation: dict
    audit: list[ReviewAuditEntry] = Field(default_factory=list)

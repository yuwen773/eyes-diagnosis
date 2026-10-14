"""New workflow contract; no unpublished result or recovery internals exposed."""

from typing import Literal

from pydantic import BaseModel


class WorkflowProgress(BaseModel):
    current: str | None
    completed: list[str]


class ResultAvailability(BaseModel):
    patientVisible: bool = False
    doctorReviewRequired: bool = False


class QualityReviewView(BaseModel):
    status: Literal["OPEN", "CLAIMED", "SUBMITTED"]
    decisionCode: Literal["APPROVE_CONTINUE", "REJECT_RESUBMIT"] | None
    reasonCode: str | None


class EvidenceCitationView(BaseModel):
    citationId: str
    documentId: str
    sourceRevision: int
    title: str
    source: str
    quotedTextDigest: str


class EvidenceView(BaseModel):
    status: Literal["SUFFICIENT", "INSUFFICIENT"]
    reasonCode: str | None
    attempts: int
    citations: list[EvidenceCitationView]


class ExplanationView(BaseModel):
    publicationStatus: Literal["NONE", "DRAFT", "VALIDATED", "PUBLISHED", "REJECTED", "WITHHELD"]
    snapshotId: str | None
    revision: str | None
    validationStatus: Literal["VALIDATED", "REJECTED"] | None


class PublishedCitation(EvidenceCitationView):
    quotedText: str


class PublishedClaim(BaseModel):
    claimId: str
    type: Literal["GENERAL_DISEASE_INFORMATION", "GENERAL_RISK_CONTEXT", "GENERAL_FOLLOW_UP_GUIDANCE"]
    text: str
    citationIds: list[str]


class ModelAssessment(BaseModel):
    diseaseCode: str
    calibratedProbability: float
    modelVersion: str
    modelWeightFingerprint: str
    inferencePolicyVersion: str
    calibrationStatus: str


class PublishedExplanation(BaseModel):
    snapshotId: str
    revision: str
    modelAssessment: ModelAssessment
    generalInformation: list[PublishedClaim]
    citations: list[PublishedCitation]
    riskNotice: str
    limitation: str


class WorkflowStatusView(BaseModel):
    workflowId: str
    status: Literal["CREATED", "QUEUED", "RUNNING", "WAITING_HUMAN_REVIEW", "COMPLETED",
                    "COMPLETED_LIMITED", "REJECTED", "CANCELLED", "FAILED"]
    workflowVersion: str
    segment: str | None
    graphDefinitionVersion: str
    progress: WorkflowProgress
    stopReasonCode: str | None
    qualityGate: Literal["PASS", "REJECT", "REVIEW"] | None = None
    qualityReview: QualityReviewView | None = None
    evidence: EvidenceView | None = None
    explanation: ExplanationView
    resultAvailability: ResultAvailability
    result: PublishedExplanation | None = None

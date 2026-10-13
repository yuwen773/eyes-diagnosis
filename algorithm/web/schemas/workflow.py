"""New workflow contract; no unpublished result or recovery internals exposed."""

from typing import Literal

from pydantic import BaseModel


class WorkflowProgress(BaseModel):
    current: str | None
    completed: list[str]


class ResultAvailability(BaseModel):
    patientVisible: Literal[False] = False
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
    resultAvailability: ResultAvailability
    result: None = None

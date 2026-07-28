package com.csust.eyediagnosis.workflow.audit;

/**
 * PR-12.2 audit event vocabulary. These events form the compliance-facing audit trail and are
 * strictly append-only: once recorded they are never updated or deleted.
 */
public enum AuditEventType {
    AI_INFERENCE_COMPLETED,
    EVIDENCE_VALIDATED,
    EXPLANATION_PUBLISHED,
    REVIEW_ASSIGNED,
    REVIEW_COMPLETED,
    RESULT_EXPOSED
}

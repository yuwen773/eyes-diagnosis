package com.csust.eyediagnosis.workflow.domain;

/** Controlled justification supplied with a human-review action. */
public enum ReviewReasonCode {
    QUALITY_APPROVED,
    QUALITY_REJECTED,
    AI_ASSESSMENT_CONFIRMED,
    AI_ASSESSMENT_CORRECTED,
    ABSTENTION_CONFIRMED,
    INDEPENDENT_REVIEW_PROVIDED,
    INCONCLUSIVE
}

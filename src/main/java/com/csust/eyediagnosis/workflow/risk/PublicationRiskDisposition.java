package com.csust.eyediagnosis.workflow.risk;

/** Workflow-safety disposition. This is not a diagnosis, severity score, or triage level. */
public enum PublicationRiskDisposition {
    PROCEED_TO_EVIDENCE,
    LIMITED_SAFETY_ABSTENTION,
    BLOCKED_TECHNICAL_FAILURE,
    BLOCKED_QUALITY_GATE,
    AUTO_PUBLICATION_ELIGIBLE,
    FINAL_REVIEW_REQUIRED,
    LIMITED_EVIDENCE,
    WITHHOLD_UNSAFE
}

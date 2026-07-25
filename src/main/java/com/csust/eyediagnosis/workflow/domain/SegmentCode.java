package com.csust.eyediagnosis.workflow.domain;

/** Stable scheduling, audit, and monitoring label; it is not a routing policy. */
public enum SegmentCode {
    INTAKE_INFERENCE_QUALITY,
    QUALITY_REVIEW_RESUME,
    EVIDENCE_RETRIEVAL_VALIDATION,
    FINAL_RISK_EXPLANATION,
    FINAL_CLINICAL_REVIEW_RESUME
}

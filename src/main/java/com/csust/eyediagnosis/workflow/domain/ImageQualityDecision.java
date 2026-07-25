package com.csust.eyediagnosis.workflow.domain;

/** Graph input only; this enum does not select a successor node. */
public enum ImageQualityDecision {
    PASS,
    REVIEW,
    REJECT
}

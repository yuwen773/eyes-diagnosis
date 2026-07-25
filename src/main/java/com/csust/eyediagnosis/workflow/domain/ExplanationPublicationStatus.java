package com.csust.eyediagnosis.workflow.domain;

/** Publication state of an immutable explanation snapshot. */
public enum ExplanationPublicationStatus {
    NONE,
    DRAFT,
    VALIDATED,
    REJECTED,
    WITHHELD,
    PUBLISHED
}

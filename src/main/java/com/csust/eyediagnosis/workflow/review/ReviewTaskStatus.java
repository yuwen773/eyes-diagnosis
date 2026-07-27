package com.csust.eyediagnosis.workflow.review;

/** Controlled lifecycle of one human review task row. */
public enum ReviewTaskStatus {
    OPEN,
    CLAIMED,
    SUBMITTED,
    CANCELLED;

    /** An active task still blocks a same-type handoff and may be claimed, submitted, or cancelled. */
    public boolean isActive() {
        return this == OPEN || this == CLAIMED;
    }
}

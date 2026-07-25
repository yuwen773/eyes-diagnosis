package com.csust.eyediagnosis.workflow.domain;

/** Lifecycle state of the workflow business aggregate. */
public enum WorkflowStatus {
    CREATED,
    QUEUED,
    RUNNING,
    WAITING_HUMAN_REVIEW,
    COMPLETED,
    COMPLETED_LIMITED,
    REJECTED,
    CANCELLED,
    FAILED;

    public boolean isTerminal() {
        return switch (this) {
            case COMPLETED, COMPLETED_LIMITED, REJECTED, CANCELLED, FAILED -> true;
            case CREATED, QUEUED, RUNNING, WAITING_HUMAN_REVIEW -> false;
        };
    }

    public boolean isActive() {
        return !isTerminal();
    }
}

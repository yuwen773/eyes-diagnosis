package com.csust.eyediagnosis.workflow.domain;

/** State of a reliable scheduler job, deliberately separate from workflow state. */
public enum WorkflowJobStatus {
    READY,
    LEASED,
    RETRY_WAIT,
    SUCCEEDED,
    FAILED,
    CANCELLED;

    public boolean isExecutable() {
        return this == READY || this == RETRY_WAIT;
    }

    public boolean isTerminal() {
        return switch (this) {
            case SUCCEEDED, FAILED, CANCELLED -> true;
            case READY, LEASED, RETRY_WAIT -> false;
        };
    }
}

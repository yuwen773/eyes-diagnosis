package com.csust.eyediagnosis.workflow.runtime;

public record SegmentExecutionAttemptResult(Status status, String detail) {
    public enum Status {
        COMMITTED,
        RETRY_SCHEDULED,
        RETRY_EXHAUSTED,
        LEASE_LOST,
        CONTRACT_REJECTED
    }
}

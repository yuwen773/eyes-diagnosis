package com.csust.eyediagnosis.workflow.job;

public enum JobRetryResult {
    RETRY_SCHEDULED,
    RETRY_EXHAUSTED,
    LEASE_LOST
}

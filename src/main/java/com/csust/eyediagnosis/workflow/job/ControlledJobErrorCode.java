package com.csust.eyediagnosis.workflow.job;

public enum ControlledJobErrorCode {
    LEASE_EXPIRED,
    LEASE_LOST,
    GRAPH_RUNTIME_FAILURE,
    RETRY_EXHAUSTED,
    EXECUTION_CANCELLED
}

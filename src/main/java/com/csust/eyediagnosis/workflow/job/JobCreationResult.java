package com.csust.eyediagnosis.workflow.job;

public record JobCreationResult(Status status, String jobId) {
    public enum Status {
        CREATED,
        ALREADY_EXISTS
    }
}

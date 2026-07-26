package com.csust.eyediagnosis.workflow.job;

public record WorkerIdentity(String value) {
    public WorkerIdentity {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("worker identity must not be blank");
        }
    }
}

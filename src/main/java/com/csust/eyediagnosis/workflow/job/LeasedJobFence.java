package com.csust.eyediagnosis.workflow.job;

public record LeasedJobFence(String jobId, String leaseOwner, String leaseToken, long leaseVersion, int attempt) {
    public LeasedJobFence {
        if (jobId == null || jobId.isBlank() || leaseOwner == null || leaseOwner.isBlank() || leaseToken == null || leaseToken.isBlank() || leaseVersion <= 0 || attempt <= 0) {
            throw new IllegalArgumentException("leased job fence must be complete");
        }
    }
}

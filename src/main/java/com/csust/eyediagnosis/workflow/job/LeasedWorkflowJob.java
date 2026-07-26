package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;

import java.time.Instant;

public record LeasedWorkflowJob(
        String jobId,
        String workflowId,
        WorkflowJobType jobType,
        SegmentCode segmentCode,
        long executionEpoch,
        int attempt,
        int maxAttempts,
        String leaseOwner,
        String leaseToken,
        long leaseVersion,
        Instant leaseUntil
) {
    public LeasedJobFence fence() {
        return new LeasedJobFence(jobId, leaseOwner, leaseToken, leaseVersion, attempt);
    }
}

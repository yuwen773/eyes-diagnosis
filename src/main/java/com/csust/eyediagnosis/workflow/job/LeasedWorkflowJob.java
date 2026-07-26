package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRecoveryToken;

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
        Instant leaseUntil,
        GraphRecoveryToken recoveryToken
) {
    public LeasedWorkflowJob(String jobId, String workflowId, WorkflowJobType jobType, SegmentCode segmentCode,
                             long executionEpoch, int attempt, int maxAttempts, String leaseOwner, String leaseToken,
                             long leaseVersion, Instant leaseUntil) {
        this(jobId, workflowId, jobType, segmentCode, executionEpoch, attempt, maxAttempts, leaseOwner, leaseToken,
                leaseVersion, leaseUntil, null);
    }

    public LeasedJobFence fence() {
        return new LeasedJobFence(jobId, leaseOwner, leaseToken, leaseVersion, attempt);
    }
}

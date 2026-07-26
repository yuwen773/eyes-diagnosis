package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRecoveryToken;

public record NewWorkflowJob(String workflowId, long executionEpoch, SegmentCode segmentCode, WorkflowJobType jobType,
                             int maxAttempts, GraphRecoveryToken recoveryToken) {
    public NewWorkflowJob(String workflowId, long executionEpoch, SegmentCode segmentCode, WorkflowJobType jobType,
                          int maxAttempts) {
        this(workflowId, executionEpoch, segmentCode, jobType, maxAttempts, null);
    }

    public NewWorkflowJob {
        if (workflowId == null || workflowId.isBlank() || executionEpoch < 0 || segmentCode == null || jobType == null || maxAttempts <= 0) {
            throw new IllegalArgumentException("new workflow job must be complete and valid");
        }
        if (jobType == WorkflowJobType.RESUME_SEGMENT && recoveryToken == null) {
            throw new IllegalArgumentException("resume job requires a graph recovery token");
        }
    }
}

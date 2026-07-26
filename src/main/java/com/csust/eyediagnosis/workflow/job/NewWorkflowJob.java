package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;

public record NewWorkflowJob(String workflowId, long executionEpoch, SegmentCode segmentCode, WorkflowJobType jobType, int maxAttempts) {
    public NewWorkflowJob {
        if (workflowId == null || workflowId.isBlank() || executionEpoch < 0 || segmentCode == null || jobType == null || maxAttempts <= 0) {
            throw new IllegalArgumentException("new workflow job must be complete and valid");
        }
    }
}

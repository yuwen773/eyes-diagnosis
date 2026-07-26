package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;

public record ResumeGraphSegmentRequest(String workflowId, long expectedWorkflowVersion, LeasedJobFence fence,
                                        GraphDefinitionBinding graphBinding, SegmentCode segmentCode,
                                        long executionEpoch, GraphRecoveryToken recoveryToken, GraphSegmentInput input)
        implements GraphSegmentExecutionRequest {
    public ResumeGraphSegmentRequest {
        GraphSegmentRequests.validate(workflowId, expectedWorkflowVersion, fence, graphBinding, segmentCode, executionEpoch, input);
        if (recoveryToken == null) {
            throw new IllegalArgumentException("recoveryToken must not be null");
        }
    }
}

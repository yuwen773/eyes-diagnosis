package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;

public record StartGraphSegmentRequest(String workflowId, long expectedWorkflowVersion, LeasedJobFence fence,
                                       GraphDefinitionBinding graphBinding, SegmentCode segmentCode,
                                       long executionEpoch, GraphSegmentInput input)
        implements GraphSegmentExecutionRequest {
    public StartGraphSegmentRequest {
        GraphSegmentRequests.validate(workflowId, expectedWorkflowVersion, fence, graphBinding, segmentCode, executionEpoch, input);
    }
}

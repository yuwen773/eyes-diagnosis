package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;

final class GraphSegmentRequests {
    private GraphSegmentRequests() {
    }

    static void validate(String workflowId, long expectedWorkflowVersion, LeasedJobFence fence,
                         GraphDefinitionBinding graphBinding, SegmentCode segmentCode, long executionEpoch,
                         GraphSegmentInput input) {
        if (workflowId == null || workflowId.isBlank() || expectedWorkflowVersion < 0 || fence == null
                || graphBinding == null || segmentCode == null || executionEpoch < 0 || input == null) {
            throw new IllegalArgumentException("graph segment request must be complete and valid");
        }
    }
}

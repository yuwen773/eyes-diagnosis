package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;

public sealed interface GraphSegmentExecutionRequest permits StartGraphSegmentRequest, ResumeGraphSegmentRequest {
    String workflowId();
    long expectedWorkflowVersion();
    LeasedJobFence fence();
    GraphDefinitionBinding graphBinding();
    com.csust.eyediagnosis.workflow.domain.SegmentCode segmentCode();
    long executionEpoch();
    GraphSegmentInput input();
}

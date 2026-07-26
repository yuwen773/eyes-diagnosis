package com.csust.eyediagnosis.workflow.graph.runtime;

public interface GraphSegmentRuntimeAdapter {
    SegmentExecutionResult execute(GraphSegmentExecutionRequest request);
}

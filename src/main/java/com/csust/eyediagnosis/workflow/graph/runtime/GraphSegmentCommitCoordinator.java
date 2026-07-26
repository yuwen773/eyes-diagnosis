package com.csust.eyediagnosis.workflow.graph.runtime;

public interface GraphSegmentCommitCoordinator {
    SegmentCommitResult commit(GraphSegmentExecutionRequest request, SegmentExecutionResult result);
}

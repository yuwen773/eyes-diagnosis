package com.csust.eyediagnosis.workflow.graph.runtime;

public record SegmentCommitResult(String workflowId, long committedWorkflowVersion, String currentJobId,
                                  String nextResumeJobId) {
}

package com.csust.eyediagnosis.workflow.graph.runtime;

public record NodeExecutionCompletion(String nodeExecutionId, String outputDigest, String resultReference) {
    public NodeExecutionCompletion {
        if (nodeExecutionId == null || nodeExecutionId.isBlank() || outputDigest == null || outputDigest.isBlank()
                || resultReference == null || resultReference.isBlank()) throw new IllegalArgumentException("node execution completion must be complete");
    }
}

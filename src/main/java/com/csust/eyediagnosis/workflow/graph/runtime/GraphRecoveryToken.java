package com.csust.eyediagnosis.workflow.graph.runtime;

public record GraphRecoveryToken(String threadId, String checkpointId) {
    public GraphRecoveryToken {
        requireText(threadId, "threadId");
        requireText(checkpointId, "checkpointId");
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}

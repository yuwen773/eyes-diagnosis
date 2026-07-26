package com.csust.eyediagnosis.workflow.graph.runtime;

/** Values supplied by a graph action for one append-only workflow audit event. */
public record WorkflowEventDraft(String eventType, String actorType, String actorId, String reasonCode,
                                 String payloadSnapshot) {
    public WorkflowEventDraft {
        if (eventType == null || eventType.isBlank() || actorType == null || actorType.isBlank()) {
            throw new IllegalArgumentException("eventType and actorType must not be blank");
        }
    }
}

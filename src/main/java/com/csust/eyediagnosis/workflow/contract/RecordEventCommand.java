package com.csust.eyediagnosis.workflow.contract;

/**
 * Immutable description of a workflow event to be persisted. Produced by
 * {@link WorkflowEventBuilder} and consumed by {@code WorkflowStateMutator#recordEvent} — the single
 * append seam for workflow events.
 */
public record RecordEventCommand(
        String workflowId,
        String eventType,
        String actorType,
        String actorId,
        long workflowVersion,
        long eventSequence,
        String segmentCode,
        String reasonCode,
        String payloadSnapshot) {
}

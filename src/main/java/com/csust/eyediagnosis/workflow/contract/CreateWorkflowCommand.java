package com.csust.eyediagnosis.workflow.contract;

/**
 * Command describing the initial CREATED workflow row. Carries only the caller-owned fields; the
 * {@code WorkflowStateMutator} fills the frozen default columns (status, version, publication /
 * exposure status, ...). This keeps the wide entity construction out of the api command surface.
 */
public record CreateWorkflowCommand(
        String workflowId,
        Long ownerUserId,
        String idempotencyKey,
        String graphDefinitionVersion,
        String graphDefinitionHash,
        String actionVersion,
        String questionText) {
}

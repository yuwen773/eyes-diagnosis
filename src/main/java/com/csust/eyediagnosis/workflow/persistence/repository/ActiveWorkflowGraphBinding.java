package com.csust.eyediagnosis.workflow.persistence.repository;

import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;

/** Narrow, non-sensitive projection used only to verify graph-version readiness. */
public record ActiveWorkflowGraphBinding(
        String workflowId,
        WorkflowStatus workflowStatus,
        String graphDefinitionVersion,
        String graphDefinitionHash,
        String actionVersion
) {
}

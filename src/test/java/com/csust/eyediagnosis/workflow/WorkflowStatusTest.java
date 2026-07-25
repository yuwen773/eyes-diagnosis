package com.csust.eyediagnosis.workflow;

import com.csust.eyediagnosis.workflow.domain.WorkflowJobStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkflowStatusTest {

    @Test
    void workflowTerminalAndActiveSemanticsAreComplementary() {
        for (WorkflowStatus status : WorkflowStatus.values()) {
            assertTrue(status.isTerminal() ^ status.isActive(), () -> "unexpected status semantics for " + status);
        }
        assertTrue(WorkflowStatus.COMPLETED.isTerminal());
        assertTrue(WorkflowStatus.COMPLETED_LIMITED.isTerminal());
        assertFalse(WorkflowStatus.WAITING_HUMAN_REVIEW.isTerminal());
    }

    @Test
    void jobStatusesKeepExecutableAndTerminalSemanticsSeparate() {
        assertTrue(WorkflowJobStatus.READY.isExecutable());
        assertTrue(WorkflowJobStatus.RETRY_WAIT.isExecutable());
        assertFalse(WorkflowJobStatus.LEASED.isExecutable());
        assertFalse(WorkflowJobStatus.LEASED.isTerminal());
        assertTrue(WorkflowJobStatus.SUCCEEDED.isTerminal());
        assertTrue(WorkflowJobStatus.FAILED.isTerminal());
        assertTrue(WorkflowJobStatus.CANCELLED.isTerminal());
    }

    @Test
    void workflowStatusDoesNotAbsorbJobOnlyStates() {
        assertThrows(IllegalArgumentException.class, () -> WorkflowStatus.valueOf("RETRY_WAIT"));
        assertThrows(IllegalArgumentException.class, () -> WorkflowStatus.valueOf("LEASED"));
        assertThrows(IllegalArgumentException.class, () -> WorkflowStatus.valueOf("READY"));
    }
}

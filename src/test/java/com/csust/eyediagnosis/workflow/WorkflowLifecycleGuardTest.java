package com.csust.eyediagnosis.workflow;

import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowTransitionException;
import com.csust.eyediagnosis.workflow.policy.WorkflowLifecycleGuard;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WorkflowLifecycleGuardTest {
    private final WorkflowLifecycleGuard guard = new WorkflowLifecycleGuard();

    @Test
    void acceptsFrozenLifecycleTransitions() {
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(WorkflowStatus.CREATED, WorkflowStatus.QUEUED));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(WorkflowStatus.CREATED, WorkflowStatus.CANCELLED));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(WorkflowStatus.QUEUED, WorkflowStatus.RUNNING));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(WorkflowStatus.RUNNING,
                WorkflowStatus.WAITING_HUMAN_REVIEW));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(WorkflowStatus.RUNNING,
                WorkflowStatus.COMPLETED_LIMITED));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(WorkflowStatus.WAITING_HUMAN_REVIEW,
                WorkflowStatus.RUNNING));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(WorkflowStatus.WAITING_HUMAN_REVIEW,
                WorkflowStatus.COMPLETED));
    }

    @Test
    void rejectsIllegalLifecycleTransitionsAndTerminalEscapes() {
        assertThrows(InvalidWorkflowTransitionException.class,
                () -> guard.requireTransitionAllowed(WorkflowStatus.CREATED, WorkflowStatus.RUNNING));
        assertThrows(InvalidWorkflowTransitionException.class,
                () -> guard.requireTransitionAllowed(WorkflowStatus.QUEUED, WorkflowStatus.COMPLETED));
        assertThrows(InvalidWorkflowTransitionException.class,
                () -> guard.requireTransitionAllowed(WorkflowStatus.RUNNING, WorkflowStatus.QUEUED));
        for (WorkflowStatus terminal : WorkflowStatus.values()) {
            if (terminal.isTerminal()) {
                assertThrows(InvalidWorkflowTransitionException.class,
                        () -> guard.requireTransitionAllowed(terminal, WorkflowStatus.RUNNING));
            }
        }
    }
}

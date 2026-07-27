package com.csust.eyediagnosis.workflow;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.exception.InvalidExplanationTransitionException;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowInvariantException;
import com.csust.eyediagnosis.workflow.explanation.ExplanationClaimValidationResult;
import com.csust.eyediagnosis.workflow.explanation.ExplanationValidationStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.ExplanationSnapshotEntity;
import com.csust.eyediagnosis.workflow.policy.ExplanationPublicationGuard;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ExplanationPublicationGuardTest {
    private final ExplanationPublicationGuard guard = new ExplanationPublicationGuard();

    @Test
    void acceptsOnlyFrozenPublicationTransitions() {
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(ExplanationPublicationStatus.NONE,
                ExplanationPublicationStatus.DRAFT));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(ExplanationPublicationStatus.DRAFT,
                ExplanationPublicationStatus.VALIDATED));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(ExplanationPublicationStatus.DRAFT,
                ExplanationPublicationStatus.REJECTED));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(ExplanationPublicationStatus.VALIDATED,
                ExplanationPublicationStatus.PUBLISHED));
        assertDoesNotThrow(() -> guard.requireTransitionAllowed(ExplanationPublicationStatus.VALIDATED,
                ExplanationPublicationStatus.WITHHELD));
    }

    @Test
    void rejectsForbiddenPublicationTransitions() {
        assertThrows(InvalidExplanationTransitionException.class,
                () -> guard.requireTransitionAllowed(ExplanationPublicationStatus.REJECTED,
                        ExplanationPublicationStatus.PUBLISHED));
        assertThrows(InvalidExplanationTransitionException.class,
                () -> guard.requireTransitionAllowed(ExplanationPublicationStatus.WITHHELD,
                        ExplanationPublicationStatus.PUBLISHED));
        assertThrows(InvalidExplanationTransitionException.class,
                () -> guard.requireTransitionAllowed(ExplanationPublicationStatus.PUBLISHED,
                        ExplanationPublicationStatus.DRAFT));
    }

    @Test
    void enforcesCompletedAndLimitedTerminalInvariants() {
        assertDoesNotThrow(() -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED,
                ExplanationPublicationStatus.PUBLISHED, true, true));
        assertThrows(InvalidWorkflowInvariantException.class,
                () -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED,
                        ExplanationPublicationStatus.VALIDATED, true, false));
        assertThrows(InvalidWorkflowInvariantException.class,
                () -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED,
                        ExplanationPublicationStatus.REJECTED, false, false));
        assertDoesNotThrow(() -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED_LIMITED,
                ExplanationPublicationStatus.NONE, false, false));
        assertDoesNotThrow(() -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED_LIMITED,
                ExplanationPublicationStatus.REJECTED, false, false));
        assertDoesNotThrow(() -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED_LIMITED,
                ExplanationPublicationStatus.WITHHELD, true, false));
        assertThrows(InvalidWorkflowInvariantException.class,
                () -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED_LIMITED,
                        ExplanationPublicationStatus.DRAFT, false, false));
        assertThrows(InvalidWorkflowInvariantException.class,
                () -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED_LIMITED,
                        ExplanationPublicationStatus.VALIDATED, true, false));
        assertThrows(InvalidWorkflowInvariantException.class,
                () -> guard.validateTerminalInvariant(WorkflowStatus.COMPLETED_LIMITED,
                        ExplanationPublicationStatus.PUBLISHED, true, true));
    }

    @Test
    void rejectsDirectPublicationOfAnUnvalidatedDraftSnapshot() {
        ExplanationSnapshotEntity draft = new ExplanationSnapshotEntity();
        draft.setPublicationStatus(ExplanationPublicationStatus.DRAFT.name());
        assertThrows(InvalidExplanationTransitionException.class,
                () -> guard.requirePublishable(draft, new ExplanationClaimValidationResult(
                        ExplanationValidationStatus.VALIDATED, java.util.List.of(), "validator-v1")));
    }
}

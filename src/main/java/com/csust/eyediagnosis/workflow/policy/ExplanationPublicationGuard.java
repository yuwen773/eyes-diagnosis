package com.csust.eyediagnosis.workflow.policy;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.exception.InvalidExplanationTransitionException;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowInvariantException;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Validates immutable explanation publication transitions and terminal invariants. */
public final class ExplanationPublicationGuard {
    private static final Map<ExplanationPublicationStatus, Set<ExplanationPublicationStatus>> ALLOWED =
            allowedTransitions();

    public void requireTransitionAllowed(ExplanationPublicationStatus current,
                                         ExplanationPublicationStatus target) {
        Objects.requireNonNull(current, "current publication status must not be null");
        Objects.requireNonNull(target, "target publication status must not be null");
        if (!ALLOWED.get(current).contains(target)) {
            throw new InvalidExplanationTransitionException("Explanation transition is not allowed: "
                    + current + " -> " + target);
        }
    }

    public void validateTerminalInvariant(WorkflowStatus workflowStatus,
                                          ExplanationPublicationStatus publicationStatus,
                                          boolean validatedSnapshotPresent,
                                          boolean publishedSnapshotPresent) {
        Objects.requireNonNull(workflowStatus, "workflow status must not be null");
        Objects.requireNonNull(publicationStatus, "publication status must not be null");
        if (workflowStatus == WorkflowStatus.COMPLETED
                && (publicationStatus != ExplanationPublicationStatus.PUBLISHED
                || !validatedSnapshotPresent || !publishedSnapshotPresent)) {
            throw new InvalidWorkflowInvariantException("COMPLETED requires a published validated explanation snapshot");
        }
        if (workflowStatus == WorkflowStatus.COMPLETED_LIMITED
                && (publicationStatus == ExplanationPublicationStatus.DRAFT
                || publicationStatus == ExplanationPublicationStatus.VALIDATED
                || publicationStatus == ExplanationPublicationStatus.PUBLISHED)) {
            throw new InvalidWorkflowInvariantException("COMPLETED_LIMITED cannot retain a draft, validated, or published explanation");
        }
    }

    private static Map<ExplanationPublicationStatus, Set<ExplanationPublicationStatus>> allowedTransitions() {
        Map<ExplanationPublicationStatus, Set<ExplanationPublicationStatus>> transitions =
                new EnumMap<>(ExplanationPublicationStatus.class);
        transitions.put(ExplanationPublicationStatus.NONE, EnumSet.of(ExplanationPublicationStatus.DRAFT));
        transitions.put(ExplanationPublicationStatus.DRAFT, EnumSet.of(ExplanationPublicationStatus.VALIDATED,
                ExplanationPublicationStatus.REJECTED));
        transitions.put(ExplanationPublicationStatus.VALIDATED, EnumSet.of(ExplanationPublicationStatus.WITHHELD,
                ExplanationPublicationStatus.PUBLISHED));
        for (ExplanationPublicationStatus status : ExplanationPublicationStatus.values()) {
            transitions.putIfAbsent(status, EnumSet.noneOf(ExplanationPublicationStatus.class));
        }
        return Map.copyOf(transitions);
    }
}

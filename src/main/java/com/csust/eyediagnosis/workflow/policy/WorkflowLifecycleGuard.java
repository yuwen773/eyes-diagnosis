package com.csust.eyediagnosis.workflow.policy;

import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowTransitionException;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Validates a caller-supplied lifecycle change without choosing one. */
public final class WorkflowLifecycleGuard {
    private static final Map<WorkflowStatus, Set<WorkflowStatus>> ALLOWED = allowedTransitions();

    public void requireTransitionAllowed(WorkflowStatus current, WorkflowStatus target) {
        Objects.requireNonNull(current, "current status must not be null");
        Objects.requireNonNull(target, "target status must not be null");
        if (!ALLOWED.get(current).contains(target)) {
            throw new InvalidWorkflowTransitionException("Workflow transition is not allowed: "
                    + current + " -> " + target);
        }
    }

    private static Map<WorkflowStatus, Set<WorkflowStatus>> allowedTransitions() {
        Map<WorkflowStatus, Set<WorkflowStatus>> transitions = new EnumMap<>(WorkflowStatus.class);
        transitions.put(WorkflowStatus.CREATED, EnumSet.of(WorkflowStatus.QUEUED,
                WorkflowStatus.CANCELLED, WorkflowStatus.FAILED));
        transitions.put(WorkflowStatus.QUEUED, EnumSet.of(WorkflowStatus.RUNNING,
                WorkflowStatus.CANCELLED, WorkflowStatus.FAILED));
        transitions.put(WorkflowStatus.RUNNING, EnumSet.of(WorkflowStatus.WAITING_HUMAN_REVIEW,
                WorkflowStatus.COMPLETED, WorkflowStatus.COMPLETED_LIMITED, WorkflowStatus.REJECTED,
                WorkflowStatus.CANCELLED, WorkflowStatus.FAILED));
        transitions.put(WorkflowStatus.WAITING_HUMAN_REVIEW, EnumSet.of(WorkflowStatus.RUNNING,
                WorkflowStatus.COMPLETED, WorkflowStatus.COMPLETED_LIMITED, WorkflowStatus.REJECTED,
                WorkflowStatus.CANCELLED, WorkflowStatus.FAILED));
        for (WorkflowStatus status : WorkflowStatus.values()) {
            transitions.putIfAbsent(status, EnumSet.noneOf(WorkflowStatus.class));
        }
        return Map.copyOf(transitions);
    }
}

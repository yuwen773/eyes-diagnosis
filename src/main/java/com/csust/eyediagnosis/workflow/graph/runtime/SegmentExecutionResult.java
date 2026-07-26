package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;

public record SegmentExecutionResult(String workflowId, SegmentCode executedSegment, GraphRuntimeDisposition disposition,
                                     String publicNextNode, SegmentCode nextSegment, GraphRecoveryToken recoveryToken,
                                     GraphDefinitionBinding graphBinding, SegmentBusinessCommitPlan businessCommitPlan) {
    public SegmentExecutionResult {
        if (workflowId == null || workflowId.isBlank() || executedSegment == null || disposition == null
                || publicNextNode == null || publicNextNode.isBlank() || graphBinding == null || businessCommitPlan == null) {
            throw new IllegalArgumentException("segment execution result must be complete");
        }
        if (disposition == GraphRuntimeDisposition.COMPLETED && (recoveryToken != null || nextSegment != null)) {
            throw new IllegalArgumentException("completed graph result must not have a recovery token or next segment");
        }
        if (disposition == GraphRuntimeDisposition.INTERRUPTED && (recoveryToken == null || nextSegment == null)) {
            throw new IllegalArgumentException("interrupted graph result requires recovery token and next segment");
        }
    }
}

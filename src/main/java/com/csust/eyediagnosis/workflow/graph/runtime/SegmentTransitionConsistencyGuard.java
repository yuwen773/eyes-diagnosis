package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.StateGraph;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.registry.GraphDefinitionRegistry;

import java.util.Objects;

/** Ensures a public graph continuation and its scheduled segment describe the same transition. */
public final class SegmentTransitionConsistencyGuard {
    private final GraphDefinitionRegistry definitions;
    private final GraphSegmentBoundaryResolver boundaries;

    public SegmentTransitionConsistencyGuard() {
        this.definitions = null;
        this.boundaries = null;
    }

    public SegmentTransitionConsistencyGuard(GraphDefinitionRegistry definitions,
                                             GraphSegmentBoundaryResolver boundaries) {
        this.definitions = Objects.requireNonNull(definitions, "definitions");
        this.boundaries = Objects.requireNonNull(boundaries, "boundaries");
    }

    public void requireConsistent(SegmentExecutionResult result) {
        if (result.disposition() == GraphRuntimeDisposition.COMPLETED) {
            if (!StateGraph.END.equals(result.publicNextNode()) || result.nextSegment() != null) {
                throw new SegmentCommitFailureException("Graph completion transition is inconsistent");
            }
            return;
        }
        if (StateGraph.END.equals(result.publicNextNode())) {
            throw new SegmentCommitFailureException("Interrupted graph transition cannot target END");
        }
        boolean publicFinalReview = "finalClinicalReview".equals(result.publicNextNode());
        boolean scheduledFinalReview = result.nextSegment() == SegmentCode.FINAL_CLINICAL_REVIEW_RESUME;
        if (publicFinalReview != scheduledFinalReview) {
            throw new SegmentCommitFailureException("Graph final-review transition is inconsistent");
        }
        if (definitions != null) {
            SegmentCode expected = boundaries.resolveNextSegment(
                    definitions.requireExecutableDefinition(result.graphBinding()), result.publicNextNode())
                    .orElseThrow(() -> new SegmentCommitFailureException("Interrupted graph transition has no next segment"));
            if (expected != result.nextSegment()) {
                throw new SegmentCommitFailureException("Graph public transition and scheduled segment differ");
            }
        }
    }
}

package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SegmentTransitionConsistencyGuardTest {
    private final SegmentTransitionConsistencyGuard guard = new SegmentTransitionConsistencyGuard();

    @Test
    void rejectsEndPublicNodeThatClaimsFinalReviewSegment() {
        assertThrows(SegmentCommitFailureException.class, () -> guard.requireConsistent(result("__END__",
                SegmentCode.FINAL_CLINICAL_REVIEW_RESUME)));
    }

    @Test
    void rejectsFinalReviewPublicNodeThatClaimsAnotherSegment() {
        assertThrows(SegmentCommitFailureException.class, () -> guard.requireConsistent(result("finalClinicalReview",
                SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION)));
    }

    @Test
    void acceptsTheCanonicalFinalReviewTransition() {
        assertDoesNotThrow(() -> guard.requireConsistent(result("finalClinicalReview",
                SegmentCode.FINAL_CLINICAL_REVIEW_RESUME)));
    }

    private static SegmentExecutionResult result(String publicNextNode, SegmentCode nextSegment) {
        SegmentBusinessCommitPlan plan = new SegmentBusinessCommitPlan(WorkflowStatus.RUNNING,
                SegmentCode.FINAL_RISK_EXPLANATION, ExplanationPublicationStatus.VALIDATED,
                PredictionExposureStatus.AVAILABLE, null, null, new NoBusinessDelta(),
                new WorkflowEventDraft("SEGMENT", "SYSTEM", "test", null, null));
        return new SegmentExecutionResult("workflow", SegmentCode.FINAL_RISK_EXPLANATION,
                GraphRuntimeDisposition.INTERRUPTED, publicNextNode, nextSegment,
                new GraphRecoveryToken("thread", "checkpoint"), new GraphDefinitionBinding("v", "h", "a"), plan);
    }
}

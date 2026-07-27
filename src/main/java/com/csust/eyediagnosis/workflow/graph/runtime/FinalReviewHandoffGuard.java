package com.csust.eyediagnosis.workflow.graph.runtime;

/** PR-08B has no PR-09 review handoff transaction, so a generic resume is unsafe. */
public final class FinalReviewHandoffGuard {
    public static final String ERROR_CODE = "HUMAN_REVIEW_HANDOFF_REQUIRED";
    public void requireAllowed(SegmentExecutionResult result) {
        if (result.disposition() == GraphRuntimeDisposition.INTERRUPTED
                && "finalClinicalReview".equals(result.publicNextNode())) {
            throw new SegmentCommitFailureException(ERROR_CODE);
        }
    }
}

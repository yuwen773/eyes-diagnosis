package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.ReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewReasonCode;

import java.util.Objects;

/** Request to submit one final review decision under both task and workflow version CAS. */
public record SubmitReviewDecisionCommand(String reviewTaskId, ReviewerPrincipal reviewer, long expectedTaskVersion,
                                          long expectedWorkflowVersion, ReviewDecision decision,
                                          ReviewReasonCode reasonCode) {
    public SubmitReviewDecisionCommand {
        if (reviewTaskId == null || reviewTaskId.isBlank()) {
            throw new IllegalArgumentException("reviewTaskId must not be blank");
        }
        Objects.requireNonNull(reviewer, "reviewer must not be null");
        if (expectedTaskVersion < 0 || expectedWorkflowVersion < 0) {
            throw new IllegalArgumentException("expected versions must not be negative");
        }
        Objects.requireNonNull(decision, "decision must not be null");
        Objects.requireNonNull(reasonCode, "reasonCode must not be null");
    }
}

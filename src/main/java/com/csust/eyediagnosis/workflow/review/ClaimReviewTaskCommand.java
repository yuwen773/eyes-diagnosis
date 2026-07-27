package com.csust.eyediagnosis.workflow.review;

import java.util.Objects;

/** Request to exclusively claim one open review task under a task-version CAS. */
public record ClaimReviewTaskCommand(String reviewTaskId, ReviewerPrincipal reviewer, long expectedTaskVersion) {
    public ClaimReviewTaskCommand {
        if (reviewTaskId == null || reviewTaskId.isBlank()) {
            throw new IllegalArgumentException("reviewTaskId must not be blank");
        }
        Objects.requireNonNull(reviewer, "reviewer must not be null");
        if (expectedTaskVersion < 0) {
            throw new IllegalArgumentException("expectedTaskVersion must not be negative");
        }
    }
}

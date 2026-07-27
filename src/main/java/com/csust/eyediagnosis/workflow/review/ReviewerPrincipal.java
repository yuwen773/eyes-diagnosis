package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.ReviewType;

import java.util.Set;

/** Caller-authenticated reviewer identity with its granted review boundaries. */
public record ReviewerPrincipal(long reviewerUserId, Set<ReviewType> grantedReviewTypes) {
    public ReviewerPrincipal {
        if (reviewerUserId <= 0) {
            throw new IllegalArgumentException("reviewerUserId must be positive");
        }
        grantedReviewTypes = grantedReviewTypes == null ? Set.of() : Set.copyOf(grantedReviewTypes);
    }
}

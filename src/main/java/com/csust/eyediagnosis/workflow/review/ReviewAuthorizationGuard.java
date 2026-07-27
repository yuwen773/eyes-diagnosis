package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.ReviewType;

import java.util.Objects;

/** Enforces review-type grants and the mandatory not-own-case rule. */
public final class ReviewAuthorizationGuard {
    public void requireAuthorized(ReviewerPrincipal reviewer, ReviewType reviewType, Long workflowOwnerUserId) {
        Objects.requireNonNull(reviewer, "reviewer must not be null");
        Objects.requireNonNull(reviewType, "review type must not be null");
        if (!reviewer.grantedReviewTypes().contains(reviewType)) {
            throw new UnauthorizedReviewActionException("Reviewer " + reviewer.reviewerUserId()
                    + " has no grant for review type " + reviewType);
        }
        if (workflowOwnerUserId != null && workflowOwnerUserId == reviewer.reviewerUserId()) {
            throw new UnauthorizedReviewActionException("Reviewer " + reviewer.reviewerUserId()
                    + " must not review a workflow they own");
        }
    }
}

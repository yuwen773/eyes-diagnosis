package com.csust.eyediagnosis.workflow.review;

/** The reviewer lacks the review grant or violates the self-review prohibition. */
public class UnauthorizedReviewActionException extends RuntimeException {
    public UnauthorizedReviewActionException(String message) {
        super(message);
    }
}

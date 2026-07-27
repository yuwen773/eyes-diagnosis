package com.csust.eyediagnosis.workflow.review;

/** The task or workflow is not in a state that accepts the requested review action. */
public class ReviewTaskStateException extends RuntimeException {
    public ReviewTaskStateException(String message) {
        super(message);
    }
}

package com.csust.eyediagnosis.workflow.review;

/** The referenced review task row does not exist. */
public class ReviewTaskNotFoundException extends RuntimeException {
    public ReviewTaskNotFoundException(String message) {
        super(message);
    }
}

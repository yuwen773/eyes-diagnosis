package com.csust.eyediagnosis.workflow.review;

/** A version CAS or uniqueness constraint lost against a concurrent review action. */
public class ReviewTaskConflictException extends RuntimeException {
    public ReviewTaskConflictException(String message) {
        super(message);
    }
}

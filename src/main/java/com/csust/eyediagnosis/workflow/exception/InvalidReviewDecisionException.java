package com.csust.eyediagnosis.workflow.exception;

public class InvalidReviewDecisionException extends IllegalArgumentException {
    public InvalidReviewDecisionException(String message) {
        super(message);
    }
}

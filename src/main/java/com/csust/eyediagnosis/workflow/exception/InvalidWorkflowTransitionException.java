package com.csust.eyediagnosis.workflow.exception;

public class InvalidWorkflowTransitionException extends IllegalArgumentException {
    public InvalidWorkflowTransitionException(String message) {
        super(message);
    }
}

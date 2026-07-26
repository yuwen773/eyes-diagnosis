package com.csust.eyediagnosis.workflow.explanation;

public record ExplanationValidationIssue(ExplanationValidationIssueCode code, String claimId) {
    public ExplanationValidationIssue { if (code == null) throw new IllegalArgumentException("issue code is required"); }
}

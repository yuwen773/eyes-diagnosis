package com.csust.eyediagnosis.workflow.explanation;

import java.util.List;

public record ExplanationClaimValidationResult(ExplanationValidationStatus status, List<ExplanationValidationIssue> issues,
                                               String validatorVersion) {
    public ExplanationClaimValidationResult {
        if (status == null || validatorVersion == null || validatorVersion.isBlank()) throw new IllegalArgumentException("validation result is incomplete");
        issues = issues == null ? List.of() : List.copyOf(issues);
    }
}

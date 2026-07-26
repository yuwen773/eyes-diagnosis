package com.csust.eyediagnosis.workflow.risk;

public record ClinicalRiskFinalResult(PublicationRiskDisposition disposition, String policyVersion) {
    public ClinicalRiskFinalResult {
        if (disposition == null || policyVersion == null || policyVersion.isBlank()) throw new IllegalArgumentException("final risk result is incomplete");
    }
}

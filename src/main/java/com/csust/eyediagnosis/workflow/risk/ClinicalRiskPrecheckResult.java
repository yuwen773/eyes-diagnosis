package com.csust.eyediagnosis.workflow.risk;

public record ClinicalRiskPrecheckResult(PublicationRiskDisposition disposition, String policyVersion) {
    public ClinicalRiskPrecheckResult {
        if (disposition == null || policyVersion == null || policyVersion.isBlank()) throw new IllegalArgumentException("precheck result is incomplete");
    }
}

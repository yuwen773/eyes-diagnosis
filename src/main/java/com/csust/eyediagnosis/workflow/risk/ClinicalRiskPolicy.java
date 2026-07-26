package com.csust.eyediagnosis.workflow.risk;

public interface ClinicalRiskPolicy {
    ClinicalRiskPrecheckResult precheck(ClinicalRiskPrecheckInput input);
    ClinicalRiskFinalResult finalAssess(ClinicalRiskFinalInput input);
    String policyVersion();
}

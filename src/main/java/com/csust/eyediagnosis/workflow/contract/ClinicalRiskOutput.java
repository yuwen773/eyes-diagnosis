package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.ClinicalRiskReasonCode;
import com.csust.eyediagnosis.workflow.domain.ClinicalRiskTier;

import java.util.Set;

public record ClinicalRiskOutput(ClinicalRiskTier riskTier,
                                 boolean humanReviewRequired,
                                 Set<ClinicalRiskReasonCode> riskReasonCodes) implements WorkflowNodeOutput {
    public ClinicalRiskOutput {
        riskTier = ContractRequirements.required(riskTier, "riskTier");
        riskReasonCodes = ContractRequirements.immutableSet(riskReasonCodes, "riskReasonCodes");
    }
}

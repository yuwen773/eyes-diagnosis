package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.ClinicalRiskPhase;
import com.csust.eyediagnosis.workflow.domain.ExplanationClaimValidationDecision;
import com.csust.eyediagnosis.workflow.domain.ImageQualityDecision;
import com.csust.eyediagnosis.workflow.domain.RetrievalSourceValidationDecision;

import java.util.Set;

/** Controlled risk inputs; free-text patient questions are deliberately absent. */
public record ClinicalRiskInput(ClinicalRiskPhase phase,
                                ImageQualityDecision imageQualityDecision,
                                Set<String> diseaseCodes,
                                String calibrationStatus,
                                boolean outOfDistribution,
                                double topTwoMargin,
                                RetrievalSourceValidationDecision evidenceStatus,
                                ExplanationClaimValidationDecision explanationValidationStatus) implements WorkflowNodeInput {
    public ClinicalRiskInput {
        phase = ContractRequirements.required(phase, "risk phase");
        imageQualityDecision = ContractRequirements.required(imageQualityDecision, "imageQualityDecision");
        diseaseCodes = ContractRequirements.immutableNonBlankSet(diseaseCodes, "diseaseCodes");
        calibrationStatus = ContractRequirements.requiredText(calibrationStatus, "calibrationStatus");
        topTwoMargin = ContractRequirements.probability(topTwoMargin, "topTwoMargin");
        evidenceStatus = ContractRequirements.required(evidenceStatus, "evidenceStatus");
        explanationValidationStatus = ContractRequirements.required(explanationValidationStatus, "explanationValidationStatus");
    }
}

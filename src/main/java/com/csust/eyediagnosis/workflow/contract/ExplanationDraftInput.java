package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.WorkflowLimitationReasonCode;

import java.util.List;
import java.util.Set;

/** Draft input deliberately excludes hidden predictions, unverified sources, and reviewer free text. */
public record ExplanationDraftInput(PatientPredictionProjection aiAssessment,
                                    List<CitationContract> acceptedCitations,
                                    ClinicalRiskOutput risk,
                                    Set<WorkflowLimitationReasonCode> limitationReasonCodes,
                                    String disclaimerVersion) implements WorkflowNodeInput {
    public ExplanationDraftInput {
        aiAssessment = ContractRequirements.required(aiAssessment, "aiAssessment");
        acceptedCitations = ContractRequirements.immutableList(acceptedCitations, "acceptedCitations");
        risk = ContractRequirements.required(risk, "risk");
        limitationReasonCodes = ContractRequirements.immutableSet(limitationReasonCodes, "limitationReasonCodes");
        disclaimerVersion = ContractRequirements.requiredText(disclaimerVersion, "disclaimerVersion");
    }
}

package com.csust.eyediagnosis.workflow.contract;

import java.util.List;

public record ExplanationClaimValidationInput(ExplanationDraftOutput draft,
                                              List<CitationContract> acceptedCitations) implements WorkflowNodeInput {
    public ExplanationClaimValidationInput {
        draft = ContractRequirements.required(draft, "draft");
        acceptedCitations = ContractRequirements.immutableList(acceptedCitations, "acceptedCitations");
    }
}

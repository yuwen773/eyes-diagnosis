package com.csust.eyediagnosis.workflow.contract;

import java.util.List;

public record RetrievalSourceValidationInput(List<CitationContract> citations) implements WorkflowNodeInput {
    public RetrievalSourceValidationInput {
        citations = ContractRequirements.immutableList(citations, "citations");
    }
}

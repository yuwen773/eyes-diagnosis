package com.csust.eyediagnosis.workflow.contract;

import java.util.List;

public record EvidenceRetrievalOutput(List<CitationContract> citations) implements WorkflowNodeOutput {
    public EvidenceRetrievalOutput {
        citations = ContractRequirements.immutableList(citations, "citations");
    }
}

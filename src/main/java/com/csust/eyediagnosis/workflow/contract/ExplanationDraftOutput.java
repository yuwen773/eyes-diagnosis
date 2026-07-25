package com.csust.eyediagnosis.workflow.contract;

import java.util.List;

public record ExplanationDraftOutput(String content,
                                     List<String> citationIds) implements WorkflowNodeOutput {
    public ExplanationDraftOutput {
        content = ContractRequirements.requiredText(content, "content");
        citationIds = ContractRequirements.immutableNonBlankList(citationIds, "citationIds");
    }
}

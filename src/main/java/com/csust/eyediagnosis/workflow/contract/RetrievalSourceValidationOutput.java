package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.RetrievalSourceValidationDecision;
import com.csust.eyediagnosis.workflow.domain.RetrievalSourceValidationReasonCode;

import java.util.Set;

public record RetrievalSourceValidationOutput(RetrievalSourceValidationDecision decision,
                                              Set<RetrievalSourceValidationReasonCode> reasonCodes) implements WorkflowNodeOutput {
    public RetrievalSourceValidationOutput {
        decision = ContractRequirements.required(decision, "retrieval validation decision");
        reasonCodes = ContractRequirements.immutableSet(reasonCodes, "retrieval validation reason codes");
    }
}

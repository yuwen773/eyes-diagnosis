package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;

import java.util.Set;

/** Retrieval scope is fixed by later policy; this contract has no Web or private-data switch. */
public record EvidenceRetrievalInput(String workflowId,
                                     String predictedDiseaseCode,
                                     Set<String> topicCodes,
                                     String queryText,
                                     int rewriteCount) implements WorkflowNodeInput {
    public EvidenceRetrievalInput {
        workflowId = ContractRequirements.requiredText(workflowId, "workflowId");
        predictedDiseaseCode = ContractRequirements.requiredText(predictedDiseaseCode, "predictedDiseaseCode");
        topicCodes = ContractRequirements.immutableNonBlankSet(topicCodes, "topicCodes");
        queryText = ContractRequirements.requiredText(queryText, "queryText");
        if (rewriteCount != 0 && rewriteCount != 1) {
            throw new InvalidWorkflowContractException("rewriteCount must be 0 or 1");
        }
    }
}

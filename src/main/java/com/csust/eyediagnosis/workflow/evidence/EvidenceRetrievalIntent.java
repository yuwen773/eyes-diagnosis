package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;
import java.util.Set;

public record EvidenceRetrievalIntent(String workflowId, long inferenceEpoch, Set<String> diseaseCodes,
                                      Set<String> topicCodes, RetrievalPurpose purpose, int requestedTopK) {
    public EvidenceRetrievalIntent {
        workflowId = EvidenceValues.required(workflowId, "workflowId");
        if (inferenceEpoch < 0) throw new InvalidWorkflowContractException("inferenceEpoch must be non-negative");
        diseaseCodes = EvidenceValues.codes(diseaseCodes, "diseaseCodes");
        topicCodes = EvidenceValues.codes(topicCodes, "topicCodes");
        if (purpose != RetrievalPurpose.DIAGNOSIS_EVIDENCE) throw new InvalidWorkflowContractException("unsupported retrieval purpose");
        if (requestedTopK < 1 || requestedTopK > EvidenceValues.MAX_TOP_K) throw new InvalidWorkflowContractException("requestedTopK is out of bounds");
    }
}

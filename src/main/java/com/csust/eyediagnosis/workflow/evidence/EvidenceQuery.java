package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;
import java.util.Set;

public record EvidenceQuery(Set<String> diseaseCodes, Set<String> topicCodes, Set<String> controlledTerms,
                            int topK, int rewriteAttempt) {
    public EvidenceQuery {
        diseaseCodes = EvidenceValues.codes(diseaseCodes, "diseaseCodes");
        topicCodes = EvidenceValues.codes(topicCodes, "topicCodes");
        controlledTerms = EvidenceValues.terms(controlledTerms);
        if (topK < 1 || topK > EvidenceValues.MAX_TOP_K) throw new InvalidWorkflowContractException("topK is out of bounds");
        if (rewriteAttempt < 0 || rewriteAttempt > 1) throw new InvalidWorkflowContractException("rewriteAttempt must be 0 or 1");
    }
}

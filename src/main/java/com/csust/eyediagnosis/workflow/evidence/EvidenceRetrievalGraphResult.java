package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.graph.runtime.EvidenceCitationDelta;

public record EvidenceRetrievalGraphResult(ValidatedEvidenceBatch batch, int retrievalCalls, int rewriteCalls) {
    public EvidenceCitationDelta citationDelta(long retrievalEpoch) {
        return new EvidenceCitationDelta(retrievalEpoch, batch.citations(), batch.sufficiency());
    }
}

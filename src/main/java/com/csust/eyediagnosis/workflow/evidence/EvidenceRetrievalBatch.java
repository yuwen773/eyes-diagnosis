package com.csust.eyediagnosis.workflow.evidence;

import java.util.List;

public record EvidenceRetrievalBatch(EvidenceRetrievalIntent intent, EvidenceQuery query,
                                     List<EvidenceCandidate> candidates, boolean skipped) {
    public EvidenceRetrievalBatch { candidates = candidates == null ? List.of() : List.copyOf(candidates); }
    public static EvidenceRetrievalBatch skipped(EvidenceRetrievalIntent intent, EvidenceQuery query) {
        return new EvidenceRetrievalBatch(intent, query, List.of(), true);
    }
}

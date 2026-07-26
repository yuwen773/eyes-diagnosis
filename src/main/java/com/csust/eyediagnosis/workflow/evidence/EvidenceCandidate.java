package com.csust.eyediagnosis.workflow.evidence;

import java.util.Map;
import java.util.Set;

/** A bounded projection of vector-store data; it never retains the backing Document or arbitrary metadata. */
public record EvidenceCandidate(String sourceId, String sourceRevision, String chunkId, String title, String quotedText,
                                String quotedTextDigest, Set<String> diseaseCodes, Set<String> topicCodes,
                                KnowledgeVisibility visibility, KnowledgeReviewStatus reviewStatus, boolean withdrawn,
                                double retrievalScore, Map<String, String> provenance) {
    public EvidenceCandidate {
        diseaseCodes = diseaseCodes == null ? Set.of() : Set.copyOf(diseaseCodes);
        topicCodes = topicCodes == null ? Set.of() : Set.copyOf(topicCodes);
        provenance = provenance == null ? Map.of() : Map.copyOf(provenance);
    }
}

package com.csust.eyediagnosis.workflow.evidence;

import java.util.Set;

/** Immutable business snapshot created only after source validation. */
public record DiagnosisCitationSnapshot(String workflowId, long retrievalEpoch, String sourceId, String sourceRevision,
                                        String chunkId, String title, String quotedText, String quotedTextDigest,
                                        Set<String> diseaseCodes, Set<String> topicCodes, double retrievalScore,
                                        String retrievalPolicyVersion, String termCatalogVersion) {
    public DiagnosisCitationSnapshot {
        workflowId = EvidenceValues.required(workflowId, "workflowId"); sourceId = EvidenceValues.required(sourceId, "sourceId");
        sourceRevision = EvidenceValues.required(sourceRevision, "sourceRevision"); chunkId = EvidenceValues.required(chunkId, "chunkId");
        title = title == null || title.isBlank() ? sourceId : title.trim(); quotedText = EvidenceValues.normalize(quotedText);
        if (quotedText.isEmpty() || quotedText.length() > EvidenceValues.MAX_QUOTE_LENGTH) throw new IllegalArgumentException("invalid quotedText");
        quotedTextDigest = EvidenceValues.required(quotedTextDigest, "quotedTextDigest"); diseaseCodes = EvidenceValues.codes(diseaseCodes, "diseaseCodes"); topicCodes = EvidenceValues.codes(topicCodes, "topicCodes");
        retrievalPolicyVersion = EvidenceValues.required(retrievalPolicyVersion, "retrievalPolicyVersion"); termCatalogVersion = EvidenceValues.required(termCatalogVersion, "termCatalogVersion");
    }
}

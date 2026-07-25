package com.csust.eyediagnosis.workflow.contract;

/** Immutable accepted-source citation shape, not a persistence entity. */
public record CitationContract(String citationId,
                               String sourceDocumentId,
                               String sourceRevision,
                               String quotedSpan,
                               String quotedSpanDigest) {
    public CitationContract {
        citationId = ContractRequirements.requiredText(citationId, "citationId");
        sourceDocumentId = ContractRequirements.requiredText(sourceDocumentId, "sourceDocumentId");
        sourceRevision = ContractRequirements.requiredText(sourceRevision, "sourceRevision");
        quotedSpan = ContractRequirements.requiredText(quotedSpan, "quotedSpan");
        quotedSpanDigest = ContractRequirements.requiredText(quotedSpanDigest, "quotedSpanDigest");
    }
}

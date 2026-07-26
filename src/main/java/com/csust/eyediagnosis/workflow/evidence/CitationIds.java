package com.csust.eyediagnosis.workflow.evidence;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Stable identifier for a frozen citation business key. */
public final class CitationIds {
    private CitationIds() { }
    public static String forSnapshot(DiagnosisCitationSnapshot citation) {
        String key = citation.workflowId() + "|" + citation.retrievalEpoch() + "|" + citation.sourceId() + "|"
                + citation.sourceRevision() + "|" + citation.quotedTextDigest();
        return UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8)).toString();
    }
}

package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import java.time.Instant;

/** Immutable explanation revision body. Status transitions are compare-and-set metadata updates only. */
public record ExplanationSnapshot(String snapshotId, String workflowId, long revision, ExplanationPublicationStatus status,
                                  ExplanationDraft draft, ExplanationClaimValidationResult validation, String citationSetDigest,
                                  String contentDigest, Instant createdAt) {
    public ExplanationSnapshot {
        if (snapshotId == null || snapshotId.isBlank() || workflowId == null || workflowId.isBlank() || revision <= 0 || status == null
                || draft == null || citationSetDigest == null || citationSetDigest.isBlank() || contentDigest == null || contentDigest.isBlank() || createdAt == null) {
            throw new IllegalArgumentException("snapshot is incomplete");
        }
    }
}

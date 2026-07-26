package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.evidence.CitationIds;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import com.csust.eyediagnosis.workflow.persistence.entity.ExplanationSnapshotEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

final class ExplanationSnapshotFactory {
    private ExplanationSnapshotFactory() { }
    static ExplanationSnapshotEntity entity(String workflowId, long revision, ExplanationDraft draft,
                                            ExplanationClaimValidationResult validation, List<DiagnosisCitationSnapshot> citations,
                                            ObjectMapper mapper) {
        try {
            List<String> citationIds = citations.stream().map(CitationIds::forSnapshot).sorted().toList();
            String citationSetDigest = digest(String.join("|", citationIds));
            String body = mapper.writeValueAsString(new StoredExplanation(draft, validation, citationIds, citationSetDigest));
            ExplanationSnapshotEntity entity = new ExplanationSnapshotEntity();
            entity.setExplanationSnapshotId(UUID.randomUUID().toString()); entity.setWorkflowId(workflowId); entity.setRevision(revision);
            entity.setPublicationStatus(validation != null && validation.status() == ExplanationValidationStatus.VALIDATED ? ExplanationPublicationStatus.VALIDATED.name() : ExplanationPublicationStatus.DRAFT.name());
            entity.setContentSnapshot(body); entity.setClaimValidationResult(validation == null ? null : mapper.writeValueAsString(validation));
            entity.setCitationSetDigest(citationSetDigest); entity.setCreatedAt(LocalDateTime.now());
            if (validation != null && validation.status() == ExplanationValidationStatus.VALIDATED) entity.setValidatedAt(LocalDateTime.now());
            return entity;
        } catch (Exception exception) { throw new IllegalStateException("unable to serialize immutable explanation snapshot", exception); }
    }
    static String digest(String value) {
        try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception exception) { throw new IllegalStateException("SHA-256 is unavailable", exception); }
    }
    private record StoredExplanation(ExplanationDraft draft, ExplanationClaimValidationResult validation, List<String> citationIds, String citationSetDigest) { }
}

package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisCitationEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisCitationRepository;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Component;
import java.time.LocalDateTime;
import java.util.UUID;

/** Inserts frozen citations only. No update or replacement operation exists. */
@Component
public final class EvidenceCitationDeltaWriter implements SegmentBusinessDeltaWriter<EvidenceCitationDelta> {
    private final DiagnosisCitationRepository citations;
    public EvidenceCitationDeltaWriter(DiagnosisCitationRepository citations) { this.citations = citations; }
    @Override public Class<EvidenceCitationDelta> supportedType() { return EvidenceCitationDelta.class; }
    @Override public void write(EvidenceCitationDelta delta) {
        for (DiagnosisCitationSnapshot citation : delta.citations()) {
            if (citations.findByBusinessKey(citation.workflowId(), delta.retrievalEpoch(), citation.sourceId(), citation.sourceRevision(), citation.quotedTextDigest()).isPresent()) continue;
            try { if (citations.insert(entity(delta.retrievalEpoch(), citation)) != 1) throw new IllegalStateException("citation was not persisted"); }
            catch (DuplicateKeyException ignored) { /* the business key makes at-least-once replay idempotent */ }
        }
    }
    private static DiagnosisCitationEntity entity(long epoch, DiagnosisCitationSnapshot snapshot) {
        DiagnosisCitationEntity entity = new DiagnosisCitationEntity(); entity.setCitationId(UUID.randomUUID().toString()); entity.setWorkflowId(snapshot.workflowId()); entity.setRetrievalEpoch(epoch);
        entity.setSourceDocumentId(snapshot.sourceId()); entity.setSourceRevision(snapshot.sourceRevision()); entity.setVisibilitySnapshot("CURATED_PUBLIC"); entity.setReviewStatusSnapshot("APPROVED");
        entity.setDiseaseCodesSnapshot(String.join(",", snapshot.diseaseCodes())); entity.setTopicCodesSnapshot(String.join(",", snapshot.topicCodes())); entity.setQuotedSpan(snapshot.quotedText()); entity.setQuotedSpanDigest(snapshot.quotedTextDigest());
        entity.setRetrievedAt(LocalDateTime.now()); return entity;
    }
}

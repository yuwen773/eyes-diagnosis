package com.csust.eyediagnosis.workflow.evidence;

import org.springframework.stereotype.Component;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Component
public final class DefaultRetrievalSourceValidator implements RetrievalSourceValidator {
    private final EvidenceTermCatalog catalog;
    public DefaultRetrievalSourceValidator(EvidenceTermCatalog catalog) { this.catalog = catalog; }
    @Override public ValidatedEvidenceBatch validate(EvidenceRetrievalIntent intent, EvidenceRetrievalBatch batch) {
        List<DiagnosisCitationSnapshot> accepted = new ArrayList<>(); Set<RetrievalValidationFailure> failures = EnumSet.noneOf(RetrievalValidationFailure.class); Set<String> seen = new HashSet<>();
        for (EvidenceCandidate candidate : batch.candidates()) {
            RetrievalValidationFailure failure = failure(intent, candidate);
            if (failure != null) { failures.add(failure); continue; }
            String key = intent.workflowId() + "\u0000" + candidate.sourceId() + "\u0000" + candidate.sourceRevision() + "\u0000" + candidate.chunkId() + "\u0000" + candidate.quotedTextDigest();
            if (!seen.add(key)) { failures.add(RetrievalValidationFailure.DUPLICATE_CITATION); continue; }
            accepted.add(new DiagnosisCitationSnapshot(intent.workflowId(), intent.inferenceEpoch(), candidate.sourceId(), candidate.sourceRevision(), candidate.chunkId(), candidate.title(), candidate.quotedText(), candidate.quotedTextDigest(), candidate.diseaseCodes(), candidate.topicCodes(), candidate.retrievalScore(), "governed-vector-v1", catalog.version()));
        }
        accepted.sort(Comparator.comparingDouble(DiagnosisCitationSnapshot::retrievalScore).reversed().thenComparing(DiagnosisCitationSnapshot::sourceId).thenComparing(DiagnosisCitationSnapshot::chunkId));
        Set<String> diseases = new LinkedHashSet<>(), topics = new LinkedHashSet<>();
        for (DiagnosisCitationSnapshot citation : accepted) { citation.diseaseCodes().stream().filter(intent.diseaseCodes()::contains).forEach(diseases::add); citation.topicCodes().stream().filter(intent.topicCodes()::contains).forEach(topics::add); }
        EvidenceSufficiencyReasonCode reason = accepted.isEmpty() ? EvidenceSufficiencyReasonCode.NO_VALID_SOURCE : diseases.isEmpty() ? EvidenceSufficiencyReasonCode.DISEASE_NOT_COVERED : topics.isEmpty() ? EvidenceSufficiencyReasonCode.TOPIC_NOT_COVERED : EvidenceSufficiencyReasonCode.SUFFICIENT;
        return new ValidatedEvidenceBatch(accepted, new EvidenceSufficiency(accepted.size(), diseases, topics, reason == EvidenceSufficiencyReasonCode.SUFFICIENT, reason), failures);
    }
    private static RetrievalValidationFailure failure(EvidenceRetrievalIntent intent, EvidenceCandidate candidate) {
        if (blank(candidate.sourceId())) return RetrievalValidationFailure.MISSING_SOURCE_ID;
        if (blank(candidate.sourceRevision())) return RetrievalValidationFailure.MISSING_REVISION;
        if (blank(candidate.chunkId())) return RetrievalValidationFailure.MISSING_CHUNK_ID;
        if (candidate.visibility() != KnowledgeVisibility.CURATED_PUBLIC) return RetrievalValidationFailure.INVALID_VISIBILITY;
        if (candidate.reviewStatus() != KnowledgeReviewStatus.APPROVED) return RetrievalValidationFailure.INVALID_REVIEW_STATUS;
        if (candidate.withdrawn()) return RetrievalValidationFailure.WITHDRAWN_SOURCE;
        if (blank(candidate.quotedText()) || EvidenceValues.normalize(candidate.quotedText()).length() > EvidenceValues.MAX_QUOTE_LENGTH) return RetrievalValidationFailure.EMPTY_QUOTE;
        if (!EvidenceValues.digest(candidate.quotedText()).equals(candidate.quotedTextDigest())) return RetrievalValidationFailure.DIGEST_MISMATCH;
        if (candidate.diseaseCodes().stream().noneMatch(intent.diseaseCodes()::contains)) return RetrievalValidationFailure.DISEASE_CODE_MISMATCH;
        if (candidate.topicCodes().stream().noneMatch(intent.topicCodes()::contains)) return RetrievalValidationFailure.TOPIC_CODE_MISMATCH;
        return null;
    }
    private static boolean blank(String value) { return value == null || value.isBlank(); }
}

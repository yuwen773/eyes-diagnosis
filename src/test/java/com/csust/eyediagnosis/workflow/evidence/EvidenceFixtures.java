package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.contract.CalibrationSnapshot;
import com.csust.eyediagnosis.workflow.contract.ImageQualitySnapshot;
import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.contract.OodSnapshot;
import com.csust.eyediagnosis.workflow.contract.PredictionSnapshot;
import com.csust.eyediagnosis.workflow.contract.VisionExposureOutput;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.SafetyAbstentionReasonCode;
import com.csust.eyediagnosis.workflow.inference.VisionExposureAction;
import java.util.Map;
import java.util.Set;

final class EvidenceFixtures {
    private EvidenceFixtures() { }
    static InferenceEnvelope valid() { return new InferenceEnvelope("wf", 3, "file:/eye.png", "input", "image/png", new ImageQualitySnapshot(100, false, Set.of()), InferenceOutcomeType.VALID_PREDICTION, new PredictionSnapshot("amd", .9, .1), null, null, new OodSnapshot(false, "IN_DISTRIBUTION", .1), new CalibrationSnapshot("CALIBRATED", .9), "m", "fingerprint", "p", "policy", "2026-01-01T00:00:00Z"); }
    static InferenceEnvelope abstention(SafetyAbstentionReasonCode reason) { return new InferenceEnvelope("wf", 3, "file:/eye.png", "input", "image/png", new ImageQualitySnapshot(100, false, Set.of()), InferenceOutcomeType.SAFETY_ABSTENTION, null, reason, null, new OodSnapshot(reason == SafetyAbstentionReasonCode.OOD, "OUT", .9), new CalibrationSnapshot("CALIBRATED", .9), "m", "fingerprint", "p", "policy", "2026-01-01T00:00:00Z"); }
    static VisionExposureOutput exposure(InferenceEnvelope envelope) { return new VisionExposureAction().execute(new com.csust.eyediagnosis.workflow.contract.VisionExposureInput(envelope), true); }
    static EvidenceRetrievalIntent intent() { return new EvidenceRetrievalIntent("wf", 3, Set.of("amd"), Set.of("DISEASE_OVERVIEW"), RetrievalPurpose.DIAGNOSIS_EVIDENCE, 5); }
    static EvidenceQuery query() { return EvidenceQueryFactory.initial(intent(), new FixedEvidenceTermCatalog()); }
    static EvidenceCandidate candidate() { return candidate(KnowledgeVisibility.CURATED_PUBLIC, KnowledgeReviewStatus.APPROVED, false, "source", "r1", "chunk-1", "text evidence", Set.of("amd"), Set.of("DISEASE_OVERVIEW")); }
    static EvidenceCandidate candidate(KnowledgeVisibility visibility, KnowledgeReviewStatus review, boolean withdrawn, String source, String revision, String chunk, String quote, Set<String> diseases, Set<String> topics) { return new EvidenceCandidate(source, revision, chunk, "title", quote, EvidenceValues.digest(quote), diseases, topics, visibility, review, withdrawn, .8, Map.of()); }
}

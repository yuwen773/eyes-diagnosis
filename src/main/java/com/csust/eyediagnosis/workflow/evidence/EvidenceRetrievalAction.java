package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.contract.VisionExposureOutput;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import org.springframework.stereotype.Component;
import java.util.Set;

/** Builds a query solely from a visible, accepted prediction; no patient question enters this action. */
@Component
public final class EvidenceRetrievalAction {
    private static final Set<String> DEFAULT_TOPICS = Set.of("DISEASE_OVERVIEW");
    private final EvidenceRetriever retriever; private final EvidenceTermCatalog catalog;
    public EvidenceRetrievalAction(EvidenceRetriever retriever, EvidenceTermCatalog catalog) { this.retriever = retriever; this.catalog = catalog; }
    public EvidenceRetrievalBatch execute(InferenceEnvelope envelope, VisionExposureOutput exposure) {
        EvidenceRetrievalIntent intent = new EvidenceRetrievalIntent(envelope.workflowId(), envelope.inferenceEpoch(),
                Set.of(eligibleDiseaseCode(envelope, exposure)), DEFAULT_TOPICS, RetrievalPurpose.DIAGNOSIS_EVIDENCE, 5);
        EvidenceQuery query = EvidenceQueryFactory.initial(intent, catalog);
        if (!eligible(envelope, exposure)) return EvidenceRetrievalBatch.skipped(intent, query);
        return new EvidenceRetrievalBatch(intent, query, retriever.retrieve(query), false);
    }
    public EvidenceRetrievalBatch execute(EvidenceRetrievalIntent intent, EvidenceQuery query) { return new EvidenceRetrievalBatch(intent, query, retriever.retrieve(query), false); }
    private static boolean eligible(InferenceEnvelope envelope, VisionExposureOutput exposure) {
        return envelope.outcomeType() == InferenceOutcomeType.VALID_PREDICTION && !envelope.quality().rejected()
                && exposure.outcomeType() == InferenceOutcomeType.VALID_PREDICTION && exposure.exposureStatus() == PredictionExposureStatus.AVAILABLE
                && exposure.predictionProjection() != null && envelope.predictionSnapshot() != null
                && envelope.predictionSnapshot().diseaseCode().equals(exposure.predictionProjection().diseaseCode());
    }
    private static String eligibleDiseaseCode(InferenceEnvelope envelope, VisionExposureOutput exposure) {
        if (envelope.predictionSnapshot() != null && exposure.predictionProjection() != null) return envelope.predictionSnapshot().diseaseCode();
        return "normal";
    }
}

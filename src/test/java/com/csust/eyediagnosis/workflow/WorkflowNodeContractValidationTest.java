package com.csust.eyediagnosis.workflow;

import com.csust.eyediagnosis.workflow.contract.EvidenceRetrievalInput;
import com.csust.eyediagnosis.workflow.contract.ImageInferenceInput;
import com.csust.eyediagnosis.workflow.contract.ImageQualitySnapshot;
import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.contract.PredictionSnapshot;
import com.csust.eyediagnosis.workflow.contract.VisionExposureOutput;
import com.csust.eyediagnosis.workflow.domain.ImageQualityReasonCode;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SafetyAbstentionReasonCode;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkflowNodeContractValidationTest {

    @Test
    void rejectsBlankWorkflowAndNegativeEpochAndInvalidRewriteCount() {
        assertThrows(InvalidWorkflowContractException.class,
                () -> new ImageInferenceInput("", 0, "cos://image", "digest"));
        assertThrows(InvalidWorkflowContractException.class,
                () -> new ImageInferenceInput("workflow-1", -1, "cos://image", "digest"));
        assertThrows(InvalidWorkflowContractException.class,
                () -> new EvidenceRetrievalInput("workflow-1", "disease", Set.of("follow-up"), "query", 2));
    }

    @Test
    void protectsCollectionContractsFromExternalMutation() {
        Set<String> topicCodes = new LinkedHashSet<>(Set.of("follow-up"));
        EvidenceRetrievalInput input = new EvidenceRetrievalInput("workflow-1", "disease", topicCodes, "query", 0);
        topicCodes.add("risk");

        assertEquals(Set.of("follow-up"), input.topicCodes());
        assertThrows(UnsupportedOperationException.class, () -> input.topicCodes().add("other"));
    }

    @Test
    void enforcesOutcomeSpecificInferenceEnvelopeReasons() {
        ImageQualitySnapshot quality = new ImageQualitySnapshot(90, false, Set.of());
        PredictionSnapshot prediction = new PredictionSnapshot("DR", 0.8, 0.2);

        InferenceEnvelope valid = new InferenceEnvelope("workflow-1", 0, "cos://image", "digest", quality,
                InferenceOutcomeType.VALID_PREDICTION, prediction, null, null, false, "model", "fingerprint", "ok");
        assertEquals(prediction, valid.predictionSnapshot());
        assertThrows(InvalidWorkflowContractException.class,
                () -> new InferenceEnvelope("workflow-1", 0, "cos://image", "digest", quality,
                        InferenceOutcomeType.SAFETY_ABSTENTION, null, null, null, true, "model", "fingerprint", "ok"));
        assertThrows(InvalidWorkflowContractException.class,
                () -> new InferenceEnvelope("workflow-1", 0, "cos://image", "digest", quality,
                        InferenceOutcomeType.TECHNICAL_FAILURE, prediction, null, TechnicalFailureCode.GRPC_TIMEOUT,
                        false, "model", "fingerprint", "ok"));
    }

    @Test
    void keepsHiddenPredictionDetailsOutOfExposureOutput() {
        assertThrows(InvalidWorkflowContractException.class,
                () -> new VisionExposureOutput(InferenceOutcomeType.SAFETY_ABSTENTION,
                        PredictionExposureStatus.WITHHELD_BY_ABSTENTION,
                        new com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection("DR", 0.8),
                        SafetyAbstentionReasonCode.LOW_CONFIDENCE, null));
        assertThrows(InvalidWorkflowContractException.class,
                () -> new VisionExposureOutput(InferenceOutcomeType.SAFETY_ABSTENTION,
                        PredictionExposureStatus.WITHHELD_BY_ABSTENTION, null,
                        SafetyAbstentionReasonCode.LOW_CONFIDENCE, TechnicalFailureCode.GRPC_TIMEOUT));
        VisionExposureOutput safe = new VisionExposureOutput(InferenceOutcomeType.TECHNICAL_FAILURE,
                PredictionExposureStatus.NOT_AVAILABLE, null, null, TechnicalFailureCode.GRPC_TIMEOUT);
        assertFalse(safe.exposureStatus() == PredictionExposureStatus.AVAILABLE);
    }

    @Test
    void mapsCurrentGrpcQualityCodesExplicitly() {
        assertEquals(ImageQualityReasonCode.BLUR, ImageQualityReasonCode.fromProtocolCode("blur"));
        assertEquals(ImageQualityReasonCode.FUNDUS_COVERAGE,
                ImageQualityReasonCode.fromProtocolCode("fundus_coverage"));
        assertThrows(IllegalArgumentException.class, () -> ImageQualityReasonCode.fromProtocolCode("free-text"));
        assertTrue(ImageQualityReasonCode.CONTRAST.protocolCode().equals("contrast"));
    }
}

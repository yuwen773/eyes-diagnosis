package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.*;
import com.csust.eyediagnosis.workflow.domain.*;
import org.junit.jupiter.api.Test;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class InferenceEnvelopeInvariantTest {
    private final ImageQualitySnapshot quality = new ImageQualitySnapshot(90, false, Set.of());
    private final OodSnapshot ood = new OodSnapshot(false, "IN_DISTRIBUTION", .1d);
    private final CalibrationSnapshot calibration = new CalibrationSnapshot("CALIBRATED", .8d);
    @Test void validPredictionRequiresSnapshotAndFingerprint() {
        assertDoesNotThrow(() -> envelope(InferenceOutcomeType.VALID_PREDICTION, new PredictionSnapshot("DR", .8d, .2d), null, null, "sha"));
        assertThrows(RuntimeException.class, () -> envelope(InferenceOutcomeType.VALID_PREDICTION, null, null, null, "sha"));
        assertThrows(RuntimeException.class, () -> envelope(InferenceOutcomeType.VALID_PREDICTION, new PredictionSnapshot("DR", .8d, .2d), null, null, "not-provided"));
    }
    @Test void abstentionAndTechnicalFailureCannotExposePrediction() {
        assertDoesNotThrow(() -> envelope(InferenceOutcomeType.SAFETY_ABSTENTION, null, SafetyAbstentionReasonCode.OOD, null, "sha"));
        assertDoesNotThrow(() -> envelope(InferenceOutcomeType.SAFETY_ABSTENTION, new PredictionSnapshot("DR", .8d, .2d), SafetyAbstentionReasonCode.OOD, null, "sha"));
        assertDoesNotThrow(() -> envelope(InferenceOutcomeType.TECHNICAL_FAILURE, null, null, TechnicalFailureCode.GRPC_TIMEOUT, "not-provided"));
    }
    private InferenceEnvelope envelope(InferenceOutcomeType outcome, PredictionSnapshot prediction, SafetyAbstentionReasonCode abstention, TechnicalFailureCode failure, String fingerprint) {
        return new InferenceEnvelope("w", 0, "file:/x", "d", "image/png", quality, outcome, prediction, abstention, failure, ood, calibration, "v", fingerprint, "p", "policy", "2026-01-01T00:00:00Z");
    }
}

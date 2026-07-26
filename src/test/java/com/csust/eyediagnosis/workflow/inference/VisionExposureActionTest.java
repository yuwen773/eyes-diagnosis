package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.*;
import com.csust.eyediagnosis.workflow.domain.*;
import org.junit.jupiter.api.Test;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class VisionExposureActionTest {
    private final VisionExposureAction action = new VisionExposureAction();
    @Test void oodAndLowConfidenceNeverExposePrediction() {
        for (SafetyAbstentionReasonCode reason : Set.of(SafetyAbstentionReasonCode.OOD, SafetyAbstentionReasonCode.LOW_CONFIDENCE)) {
            VisionExposureOutput output = action.execute(new VisionExposureInput(envelope(reason)), true);
            assertNull(output.predictionProjection());
            assertEquals(reason == SafetyAbstentionReasonCode.OOD ? PredictionExposureStatus.WITHHELD_BY_OOD : PredictionExposureStatus.WITHHELD_BY_ABSTENTION, output.exposureStatus());
        }
    }
    @Test void qualityGateWithholdsOtherwiseValidPrediction() {
        InferenceEnvelope valid = new InferenceEnvelope("w", 0, "file:/x", "d", "image/png", new ImageQualitySnapshot(100, false, Set.of()), InferenceOutcomeType.VALID_PREDICTION, new PredictionSnapshot("DR", .8, .2), null, null, new OodSnapshot(false, "IN_DISTRIBUTION", .1), new CalibrationSnapshot("CALIBRATED", .8), "v", "sha", "p", "policy", "2026-01-01T00:00:00Z");
        VisionExposureOutput output = action.execute(new VisionExposureInput(valid), false);
        assertEquals(PredictionExposureStatus.WITHHELD_BY_QUALITY_GATE, output.exposureStatus()); assertNull(output.predictionProjection());
    }
    private static InferenceEnvelope envelope(SafetyAbstentionReasonCode reason) { return new InferenceEnvelope("w", 0, "file:/x", "d", "image/png", new ImageQualitySnapshot(100, false, Set.of()), InferenceOutcomeType.SAFETY_ABSTENTION, null, reason, null, new OodSnapshot(reason == SafetyAbstentionReasonCode.OOD, "OUT_OF_DISTRIBUTION", .9), new CalibrationSnapshot("CALIBRATED", .8), "v", "sha", "p", "policy", "2026-01-01T00:00:00Z"); }
}

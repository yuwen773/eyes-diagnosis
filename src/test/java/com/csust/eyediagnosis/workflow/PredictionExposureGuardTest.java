package com.csust.eyediagnosis.workflow;

import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.policy.PredictionExposureGuard;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PredictionExposureGuardTest {
    private final PredictionExposureGuard guard = new PredictionExposureGuard();

    @Test
    void exposesOnlyAvailableValidPredictions() {
        assertTrue(guard.mayExposePrediction(PredictionExposureStatus.AVAILABLE,
                InferenceOutcomeType.VALID_PREDICTION));
        assertFalse(guard.mayExposePrediction(PredictionExposureStatus.WITHHELD_BY_QUALITY_GATE,
                InferenceOutcomeType.VALID_PREDICTION));
        assertFalse(guard.mayExposePrediction(PredictionExposureStatus.WITHHELD_BY_ABSTENTION,
                InferenceOutcomeType.SAFETY_ABSTENTION));
        assertFalse(guard.mayExposePrediction(PredictionExposureStatus.WITHHELD_BY_OOD,
                InferenceOutcomeType.SAFETY_ABSTENTION));
        assertFalse(guard.mayExposePrediction(PredictionExposureStatus.AVAILABLE,
                InferenceOutcomeType.TECHNICAL_FAILURE));
    }
}

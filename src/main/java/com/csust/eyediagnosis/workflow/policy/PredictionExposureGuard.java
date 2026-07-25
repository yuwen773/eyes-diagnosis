package com.csust.eyediagnosis.workflow.policy;

import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;

import java.util.Objects;

/** Single patient-projection safety predicate for prediction details. */
public final class PredictionExposureGuard {
    public boolean mayExposePrediction(PredictionExposureStatus exposureStatus,
                                       InferenceOutcomeType outcomeType) {
        Objects.requireNonNull(exposureStatus, "prediction exposure status must not be null");
        Objects.requireNonNull(outcomeType, "inference outcome type must not be null");
        return exposureStatus == PredictionExposureStatus.AVAILABLE
                && outcomeType == InferenceOutcomeType.VALID_PREDICTION;
    }
}

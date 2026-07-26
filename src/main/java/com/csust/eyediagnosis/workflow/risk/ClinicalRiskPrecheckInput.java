package com.csust.eyediagnosis.workflow.risk;

import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.ImageQualityDecision;

public record ClinicalRiskPrecheckInput(InferenceOutcomeType outcomeType,
                                        PredictionExposureStatus exposureStatus,
                                        ImageQualityDecision qualityDecision,
                                        String modelFingerprint) {
    public ClinicalRiskPrecheckInput {
        if (outcomeType == null || exposureStatus == null || qualityDecision == null
                || modelFingerprint == null || modelFingerprint.isBlank()) throw new IllegalArgumentException("precheck input is incomplete");
    }
}

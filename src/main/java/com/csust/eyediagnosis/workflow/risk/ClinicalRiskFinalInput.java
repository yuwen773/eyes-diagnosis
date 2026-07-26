package com.csust.eyediagnosis.workflow.risk;

import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.ImageQualityDecision;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiency;

public record ClinicalRiskFinalInput(InferenceOutcomeType outcomeType,
                                     PredictionExposureStatus exposureStatus,
                                     ImageQualityDecision qualityDecision,
                                     EvidenceSufficiency evidenceSufficiency,
                                     boolean citationStateValid,
                                     boolean modelPolicyRequiresReview) {
    public ClinicalRiskFinalInput {
        if (outcomeType == null || exposureStatus == null || qualityDecision == null || evidenceSufficiency == null) {
            throw new IllegalArgumentException("final risk input is incomplete");
        }
    }
}

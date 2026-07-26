package com.csust.eyediagnosis.workflow.risk;

import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;

/** Deterministic workflow publication policy; it never reads patient free text or invokes a model. */
public final class DeterministicClinicalRiskPolicy implements ClinicalRiskPolicy {
    public static final String VERSION = "clinical-risk-policy-v1";

    @Override public ClinicalRiskPrecheckResult precheck(ClinicalRiskPrecheckInput input) {
        PublicationRiskDisposition disposition;
        if (input.outcomeType() == InferenceOutcomeType.TECHNICAL_FAILURE) disposition = PublicationRiskDisposition.BLOCKED_TECHNICAL_FAILURE;
        else if (input.qualityDecision() != com.csust.eyediagnosis.workflow.domain.ImageQualityDecision.PASS) disposition = PublicationRiskDisposition.BLOCKED_QUALITY_GATE;
        else if (input.outcomeType() == InferenceOutcomeType.SAFETY_ABSTENTION) disposition = PublicationRiskDisposition.LIMITED_SAFETY_ABSTENTION;
        else if (input.exposureStatus() == PredictionExposureStatus.AVAILABLE) disposition = PublicationRiskDisposition.PROCEED_TO_EVIDENCE;
        else disposition = PublicationRiskDisposition.BLOCKED_QUALITY_GATE;
        return new ClinicalRiskPrecheckResult(disposition, VERSION);
    }

    @Override public ClinicalRiskFinalResult finalAssess(ClinicalRiskFinalInput input) {
        PublicationRiskDisposition disposition;
        if (input.outcomeType() == InferenceOutcomeType.TECHNICAL_FAILURE || !input.citationStateValid()) disposition = PublicationRiskDisposition.WITHHOLD_UNSAFE;
        else if (input.qualityDecision() != com.csust.eyediagnosis.workflow.domain.ImageQualityDecision.PASS
                || input.outcomeType() == InferenceOutcomeType.SAFETY_ABSTENTION || input.exposureStatus() != PredictionExposureStatus.AVAILABLE) disposition = PublicationRiskDisposition.LIMITED_EVIDENCE;
        else if (!input.evidenceSufficiency().sufficient()) disposition = PublicationRiskDisposition.LIMITED_EVIDENCE;
        else if (input.modelPolicyRequiresReview()) disposition = PublicationRiskDisposition.FINAL_REVIEW_REQUIRED;
        else disposition = PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE;
        return new ClinicalRiskFinalResult(disposition, VERSION);
    }

    @Override public String policyVersion() { return VERSION; }
}

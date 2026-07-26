package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.contract.VisionExposureInput;
import com.csust.eyediagnosis.workflow.contract.VisionExposureOutput;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import org.springframework.stereotype.Component;

@Component public final class VisionExposureAction { public VisionExposureOutput execute(VisionExposureInput input, boolean qualityGatePassed) { var e = input.envelope(); if (e.outcomeType() == InferenceOutcomeType.TECHNICAL_FAILURE) return new VisionExposureOutput(e.outcomeType(), PredictionExposureStatus.NOT_AVAILABLE, null, null, e.technicalFailureCode()); if (e.outcomeType() == InferenceOutcomeType.SAFETY_ABSTENTION) return new VisionExposureOutput(e.outcomeType(), e.safetyAbstentionReasonCode() == com.csust.eyediagnosis.workflow.domain.SafetyAbstentionReasonCode.OOD ? PredictionExposureStatus.WITHHELD_BY_OOD : PredictionExposureStatus.WITHHELD_BY_ABSTENTION, null, e.safetyAbstentionReasonCode(), null); if (!qualityGatePassed) return new VisionExposureOutput(e.outcomeType(), PredictionExposureStatus.WITHHELD_BY_QUALITY_GATE, null, null, null); return new VisionExposureOutput(e.outcomeType(), PredictionExposureStatus.AVAILABLE, new PatientPredictionProjection(e.predictionSnapshot().diseaseCode(), e.predictionSnapshot().calibratedProbability()), null, null); } }

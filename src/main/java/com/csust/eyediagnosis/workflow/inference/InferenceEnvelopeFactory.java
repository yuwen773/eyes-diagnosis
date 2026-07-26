package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.CalibrationSnapshot;
import com.csust.eyediagnosis.workflow.contract.ImageQualitySnapshot;
import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.contract.OodSnapshot;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.SafetyAbstentionReasonCode;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;

import java.time.Instant;
import java.util.Set;

final class InferenceEnvelopeFactory {
    private InferenceEnvelopeFactory() { }

    static InferenceEnvelope fromResult(ValidatedImageInput input, long epoch, DiagnoseModelResult result,
                                        WorkflowInferenceProperties properties) {
        if (!properties.getExpectedModelFingerprint().isBlank()
                && !properties.getExpectedModelFingerprint().equalsIgnoreCase(result.modelWeightFingerprint())) {
            return technical(input, epoch, TechnicalFailureCode.MODEL_FINGERPRINT_MISMATCH);
        }
        if (result.oodSnapshot().outOfDistribution()) {
            return envelope(input, epoch, result, InferenceOutcomeType.SAFETY_ABSTENTION, null,
                    SafetyAbstentionReasonCode.OOD, null);
        }
        if (result.rejected()) {
            SafetyAbstentionReasonCode reason = "LOW_CONFIDENCE".equalsIgnoreCase(result.abstainReason())
                    ? SafetyAbstentionReasonCode.LOW_CONFIDENCE : SafetyAbstentionReasonCode.MODEL_POLICY_REJECTED;
            return envelope(input, epoch, result, InferenceOutcomeType.SAFETY_ABSTENTION, null, reason, null);
        }
        if (result.prediction() == null) return technical(input, epoch, TechnicalFailureCode.INVALID_RESPONSE_CONTRACT);
        return envelope(input, epoch, result, InferenceOutcomeType.VALID_PREDICTION, result.prediction(), null, null);
    }

    static InferenceEnvelope technical(ValidatedImageInput input, long epoch, TechnicalFailureCode code) {
        DiagnoseModelResult synthetic = new DiagnoseModelResult(new ImageQualitySnapshot(0, false, Set.of()), null, false, "",
                new OodSnapshot(false, "not-provided", null), new CalibrationSnapshot("not-provided", null),
                "not-provided", "not-provided", "not-provided", "not-provided");
        return envelope(input, epoch, synthetic, InferenceOutcomeType.TECHNICAL_FAILURE, null, null, code);
    }

    private static InferenceEnvelope envelope(ValidatedImageInput input, long epoch, DiagnoseModelResult result,
                                              InferenceOutcomeType outcome, com.csust.eyediagnosis.workflow.contract.PredictionSnapshot prediction,
                                              SafetyAbstentionReasonCode abstention, TechnicalFailureCode failure) {
        return new InferenceEnvelope(input.workflowId(), epoch, input.imageObjectReference(), input.inputDigest(), input.mediaType(),
                result.quality(), outcome, prediction, abstention, failure, result.oodSnapshot(), result.calibrationSnapshot(),
                result.modelVersion(), result.modelWeightFingerprint(), result.preprocessVersion(), result.inferencePolicyVersion(), Instant.now().toString());
    }
}

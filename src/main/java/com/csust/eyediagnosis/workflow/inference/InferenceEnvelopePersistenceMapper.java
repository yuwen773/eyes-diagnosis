package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.CalibrationSnapshot;
import com.csust.eyediagnosis.workflow.contract.ImageQualitySnapshot;
import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.contract.OodSnapshot;
import com.csust.eyediagnosis.workflow.contract.PredictionSnapshot;
import com.csust.eyediagnosis.workflow.domain.ImageQualityReasonCode;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.SafetyAbstentionReasonCode;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import com.csust.eyediagnosis.workflow.persistence.entity.InferenceEnvelopeEntity;

import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

final class InferenceEnvelopePersistenceMapper {
    private InferenceEnvelopePersistenceMapper() { }
    static InferenceEnvelope fromEntity(InferenceEnvelopeEntity entity) {
        Set<ImageQualityReasonCode> reasons = entity.getQualityReasonCodesSnapshot() == null ? Set.of()
                : Arrays.stream(entity.getQualityReasonCodesSnapshot().replace("[", "").replace("]", "").split(","))
                .map(String::trim).filter(value -> !value.isBlank()).map(ImageQualityReasonCode::valueOf).collect(Collectors.toUnmodifiableSet());
        PredictionSnapshot prediction = decodePrediction(entity.getPredictionSnapshot());
        return new InferenceEnvelope(entity.getWorkflowId(), entity.getInferenceEpoch(), entity.getImageObjectReference(), entity.getInputDigest(),
                entity.getDetectedMediaType() == null ? "application/octet-stream" : entity.getDetectedMediaType(),
                new ImageQualitySnapshot(entity.getQualityScore(), "REJECT".equals(entity.getQualityOutcome()), reasons),
                InferenceOutcomeType.valueOf(entity.getInferenceOutcomeType()), prediction,
                entity.getSafetyAbstentionReasonCode() == null ? null : SafetyAbstentionReasonCode.valueOf(entity.getSafetyAbstentionReasonCode()),
                entity.getTechnicalFailureCode() == null ? null : TechnicalFailureCode.valueOf(entity.getTechnicalFailureCode()),
                new OodSnapshot(entity.getOodSnapshot() != null && entity.getOodSnapshot().contains("true"), "not-provided", null),
                new CalibrationSnapshot("not-provided", null), entity.getModelVersion(), entity.getModelWeightFingerprint(),
                entity.getPreprocessVersion() == null ? "not-provided" : entity.getPreprocessVersion(),
                entity.getInferencePolicyVersion() == null ? "not-provided" : entity.getInferencePolicyVersion(),
                entity.getInferredAt().toInstant(ZoneOffset.UTC).toString());
    }
    private static PredictionSnapshot decodePrediction(String raw) {
        if (raw == null) return null;
        try {
            String body = raw.substring(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
            String[] values = body.split(", ");
            return new PredictionSnapshot(values[0].substring("diseaseCode=".length()),
                    Double.parseDouble(values[1].substring("calibratedProbability=".length())),
                    Double.parseDouble(values[2].substring("topTwoMargin=".length())));
        } catch (RuntimeException exception) { throw new IllegalStateException("persisted prediction snapshot is invalid", exception); }
    }
}

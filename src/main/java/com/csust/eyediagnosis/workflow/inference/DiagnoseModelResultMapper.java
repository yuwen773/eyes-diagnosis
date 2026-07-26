package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.workflow.contract.CalibrationSnapshot;
import com.csust.eyediagnosis.workflow.contract.ImageQualitySnapshot;
import com.csust.eyediagnosis.workflow.contract.OodSnapshot;
import com.csust.eyediagnosis.workflow.contract.PredictionSnapshot;
import com.csust.eyediagnosis.workflow.domain.ImageQualityReasonCode;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/** Maps generated protocol values once, rejecting incomplete or unsafe responses. */
public final class DiagnoseModelResultMapper {
    private DiagnoseModelResultMapper() { }

    public static DiagnoseModelResult fromProto(DiagnosisProto.DiagnosisResponse response) {
        if (response == null) {
            throw invalid("null response", null);
        }
        try {
            ImageQualitySnapshot quality = new ImageQualitySnapshot(response.getQualityScore(), response.getRejected(),
                    parseQualityReasons(response.getQualityReasons()));
            boolean ood = response.getIsOod()
                    || response.getOodStatus() == DiagnosisProto.OodStatus.OUT_OF_DISTRIBUTION;
            OodSnapshot oodSnapshot = new OodSnapshot(ood, response.getOodStatus().name(), response.getOodScore());
            Double calibrated = response.getCalibrationStatus().isBlank() ? null : response.getCalibratedProbability();
            CalibrationSnapshot calibration = new CalibrationSnapshot(
                    response.getCalibrationStatus().isBlank() ? "not-provided" : response.getCalibrationStatus(), calibrated);
            PredictionSnapshot prediction = response.getPredictedLabel().isBlank() ? null
                    : new PredictionSnapshot(response.getPredictedLabel(), response.getCalibratedProbability(), topTwoMargin(response));
            return new DiagnoseModelResult(quality, prediction, response.getRejected(), response.getAbstainReason(),
                    oodSnapshot, calibration, requiredProtocolValue(response.getModelVersion(), "model version"),
                    requiredProtocolValue(response.getWeightSha256(), "model fingerprint"),
                    response.getPreprocessVersion().isBlank() ? "not-provided" : response.getPreprocessVersion(),
                    response.getInferencePolicyVersion().isBlank() ? "not-provided" : response.getInferencePolicyVersion(),
                    response.getDescription(), response.getReliabilityScore(), response.getTopPredictionsList().stream()
                    .map(item -> new ModelPrediction(item.getLabel(), item.getProbability())).toList(), response.getRequiresReview());
        } catch (IllegalArgumentException exception) {
            throw invalid("invalid response contract", exception);
        }
    }

    private static Set<ImageQualityReasonCode> parseQualityReasons(String raw) {
        if (raw == null || raw.isBlank()) return Set.of();
        return Arrays.stream(raw.split(","))
                .map(String::trim).filter(value -> !value.isEmpty())
                .map(ImageQualityReasonCode::fromProtocolCode).collect(Collectors.toUnmodifiableSet());
    }

    private static double topTwoMargin(DiagnosisProto.DiagnosisResponse response) {
        if (response.getTopPredictionsCount() < 2) return 0d;
        double first = response.getTopPredictions(0).getProbability();
        double second = response.getTopPredictions(1).getProbability();
        if (!Double.isFinite(first) || !Double.isFinite(second) || first < 0 || second < 0 || first > 1 || second > 1) {
            throw new IllegalArgumentException("invalid top prediction probability");
        }
        return Math.max(0d, first - second);
    }

    private static String requiredProtocolValue(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("missing " + field);
        return value;
    }

    private static DiagnoseModelException invalid(String message, Throwable cause) {
        return new DiagnoseModelException(TechnicalFailureCode.INVALID_RESPONSE_CONTRACT, message, cause);
    }
}

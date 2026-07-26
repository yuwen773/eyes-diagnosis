package com.csust.eyediagnosis.grpc;

import com.csust.eyediagnosis.workflow.inference.DiagnoseModelClient;
import com.csust.eyediagnosis.workflow.inference.DiagnoseModelRequest;
import com.csust.eyediagnosis.workflow.inference.DiagnoseModelResult;
import com.csust.eyediagnosis.workflow.inference.ModelPrediction;
import org.springframework.stereotype.Component;

import java.security.MessageDigest;

/** Legacy synchronous compatibility projection. Transport ownership remains in GrpcDiagnoseModelClient. */
@Component
public class DiagnosisGrpcClient {
    private final DiagnoseModelClient modelClient;
    public DiagnosisGrpcClient(DiagnoseModelClient modelClient) { this.modelClient = modelClient; }
    public DiagnosisProto.DiagnosisResponse diagnose(byte[] imageData, String imageFormat) {
        DiagnoseModelResult result = modelClient.diagnose(new DiagnoseModelRequest("legacy-" + digest(imageData), 0,
                imageData, digest(imageData), imageFormat));
        DiagnosisProto.DiagnosisResponse.Builder response = DiagnosisProto.DiagnosisResponse.newBuilder()
                .setPredictedLabel(result.prediction() == null ? "" : result.prediction().diseaseCode())
                .setProbability(result.prediction() == null ? 0 : result.prediction().calibratedProbability())
                .setReliabilityScore(result.reliabilityScore()).setDescription(result.description())
                .setRejected(result.rejected()).setAbstainReason(result.abstainReason() == null ? "" : result.abstainReason())
                .setQualityScore(result.quality().score()).setRequiresReview(result.requiresReview())
                .setQualityReasons(result.quality().reasonCodes().stream().map(code -> code.protocolCode() == null ? "" : code.protocolCode()).filter(code -> !code.isBlank()).collect(java.util.stream.Collectors.joining(",")))
                .setIsOod(result.oodSnapshot().outOfDistribution()).setOodStatus(parseOod(result.oodSnapshot().status()))
                .setOodScore(result.oodSnapshot().score() == null ? 0 : result.oodSnapshot().score())
                .setCalibrationStatus(result.calibrationSnapshot().status()).setCalibratedProbability(result.calibrationSnapshot().calibratedProbability() == null ? 0 : result.calibrationSnapshot().calibratedProbability())
                .setModelVersion(result.modelVersion()).setWeightSha256(result.modelWeightFingerprint())
                .setPreprocessVersion(result.preprocessVersion()).setInferencePolicyVersion(result.inferencePolicyVersion());
        for (ModelPrediction prediction : result.topPredictions()) response.addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder().setLabel(prediction.label()).setProbability(prediction.probability()));
        return response.build();
    }
    private static DiagnosisProto.OodStatus parseOod(String value) { try { return DiagnosisProto.OodStatus.valueOf(value); } catch (IllegalArgumentException exception) { return DiagnosisProto.OodStatus.OOD_STATUS_UNSPECIFIED; } }
    private static String digest(byte[] bytes) { try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch (Exception exception) { throw new IllegalStateException(exception); } }
}

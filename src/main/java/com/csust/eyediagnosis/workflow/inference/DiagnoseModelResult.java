package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.CalibrationSnapshot;
import com.csust.eyediagnosis.workflow.contract.ImageQualitySnapshot;
import com.csust.eyediagnosis.workflow.contract.OodSnapshot;
import com.csust.eyediagnosis.workflow.contract.PredictionSnapshot;

/** Protocol-neutral complete snapshot returned by the one model adapter. */
public record DiagnoseModelResult(ImageQualitySnapshot quality, PredictionSnapshot prediction,
                                  boolean rejected, String abstainReason, OodSnapshot oodSnapshot,
                                  CalibrationSnapshot calibrationSnapshot, String modelVersion,
                                  String modelWeightFingerprint, String preprocessVersion,
                                  String inferencePolicyVersion, String description, int reliabilityScore,
                                  java.util.List<ModelPrediction> topPredictions, boolean requiresReview) {
    public DiagnoseModelResult {
        if (quality == null || oodSnapshot == null || calibrationSnapshot == null) throw new IllegalArgumentException("model result snapshots are required");
        modelVersion = required(modelVersion, "modelVersion"); modelWeightFingerprint = required(modelWeightFingerprint, "modelWeightFingerprint"); preprocessVersion = required(preprocessVersion, "preprocessVersion"); inferencePolicyVersion = required(inferencePolicyVersion, "inferencePolicyVersion");
        description = description == null ? "" : description;
        if (reliabilityScore < 0 || reliabilityScore > 100) throw new IllegalArgumentException("reliabilityScore must be in range");
        topPredictions = topPredictions == null ? java.util.List.of() : java.util.List.copyOf(topPredictions);
    }
    public DiagnoseModelResult(ImageQualitySnapshot quality, PredictionSnapshot prediction, boolean rejected, String abstainReason, OodSnapshot oodSnapshot, CalibrationSnapshot calibrationSnapshot, String modelVersion, String modelWeightFingerprint, String preprocessVersion, String inferencePolicyVersion) {
        this(quality, prediction, rejected, abstainReason, oodSnapshot, calibrationSnapshot, modelVersion, modelWeightFingerprint, preprocessVersion, inferencePolicyVersion, "", 0, java.util.List.of(), false);
    }
    private static String required(String value, String name) { if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " is required"); return value; }
}

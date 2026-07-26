package com.csust.eyediagnosis.workflow.inference;

public record ModelPrediction(String label, double probability) {
    public ModelPrediction {
        if (label == null || label.isBlank() || !Double.isFinite(probability) || probability < 0 || probability > 1) {
            throw new IllegalArgumentException("model prediction must be valid");
        }
    }
}

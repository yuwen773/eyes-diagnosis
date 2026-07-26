package com.csust.eyediagnosis.workflow.inference;

public record DiagnoseModelRequest(String workflowId, long inferenceEpoch, byte[] imageBytes,
                                   String inputDigest, String mediaType) {
    public DiagnoseModelRequest {
        workflowId = required(workflowId, "workflowId");
        if (inferenceEpoch < 0) throw new IllegalArgumentException("inferenceEpoch must not be negative");
        imageBytes = imageBytes == null ? null : imageBytes.clone();
        if (imageBytes == null || imageBytes.length == 0) {
            throw new IllegalArgumentException("imageBytes must not be empty");
        }
        inputDigest = required(inputDigest, "inputDigest");
        mediaType = required(mediaType, "mediaType");
    }

    @Override
    public byte[] imageBytes() {
        return imageBytes.clone();
    }
    private static String required(String value, String name) { if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " is required"); return value; }
}

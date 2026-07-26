package com.csust.eyediagnosis.workflow.inference;

public record ValidatedImageInput(String workflowId, String imageObjectReference, String inputDigest,
                                  String mediaType, byte[] imageBytes) {
    public ValidatedImageInput {
        workflowId = required(workflowId, "workflowId"); imageObjectReference = required(imageObjectReference, "imageObjectReference"); inputDigest = required(inputDigest, "inputDigest"); mediaType = required(mediaType, "mediaType");
        imageBytes = imageBytes == null ? null : imageBytes.clone();
        if (imageBytes == null || imageBytes.length == 0) throw new IllegalArgumentException("imageBytes must not be empty");
    }
    @Override public byte[] imageBytes() { return imageBytes.clone(); }
    private static String required(String value, String name) { if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " is required"); return value; }
}

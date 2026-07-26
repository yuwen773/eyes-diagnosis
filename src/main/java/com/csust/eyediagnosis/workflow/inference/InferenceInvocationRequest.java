package com.csust.eyediagnosis.workflow.inference;

public record InferenceInvocationRequest(ValidatedImageInput input, long inferenceEpoch,
                                         String graphDefinitionVersion, String actionVersion) {
    public InferenceInvocationRequest {
        if (input == null || inferenceEpoch < 0 || graphDefinitionVersion == null || graphDefinitionVersion.isBlank()
                || actionVersion == null || actionVersion.isBlank()) throw new IllegalArgumentException("inference invocation request must be complete");
    }
}

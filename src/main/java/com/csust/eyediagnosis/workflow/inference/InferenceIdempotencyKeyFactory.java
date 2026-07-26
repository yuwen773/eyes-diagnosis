package com.csust.eyediagnosis.workflow.inference;

public interface InferenceIdempotencyKeyFactory {
    String create(String workflowId, String graphDefinitionVersion, String actionVersion, long inferenceEpoch);
}

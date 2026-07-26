package com.csust.eyediagnosis.workflow.inference;

import org.springframework.stereotype.Component;

@Component
public final class DefaultInferenceIdempotencyKeyFactory implements InferenceIdempotencyKeyFactory {
    @Override
    public String create(String workflowId, String graphDefinitionVersion, String actionVersion, long inferenceEpoch) {
        if (workflowId == null || workflowId.isBlank() || graphDefinitionVersion == null || graphDefinitionVersion.isBlank()
                || actionVersion == null || actionVersion.isBlank() || inferenceEpoch < 0) {
            throw new IllegalArgumentException("inference idempotency key inputs must be valid");
        }
        return workflowId + ':' + graphDefinitionVersion + ':' + actionVersion + ":IMAGE_INFERENCE:" + inferenceEpoch;
    }
}

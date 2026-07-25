package com.csust.eyediagnosis.workflow.contract;

public record ImageInferenceOutput(InferenceEnvelope envelope) implements WorkflowNodeOutput {
    public ImageInferenceOutput {
        envelope = ContractRequirements.required(envelope, "envelope");
    }
}

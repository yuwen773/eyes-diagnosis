package com.csust.eyediagnosis.workflow.contract;

public record VisionExposureInput(InferenceEnvelope envelope) implements WorkflowNodeInput {
    public VisionExposureInput {
        envelope = ContractRequirements.required(envelope, "envelope");
    }
}

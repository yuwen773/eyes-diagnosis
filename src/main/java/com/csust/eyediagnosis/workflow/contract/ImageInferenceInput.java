package com.csust.eyediagnosis.workflow.contract;

public record ImageInferenceInput(String workflowId,
                                  long inferenceEpoch,
                                  String imageObjectReference,
                                  String inputDigest) implements WorkflowNodeInput {
    public ImageInferenceInput {
        workflowId = ContractRequirements.requiredText(workflowId, "workflowId");
        inferenceEpoch = ContractRequirements.nonNegative(inferenceEpoch, "inferenceEpoch");
        imageObjectReference = ContractRequirements.requiredText(imageObjectReference, "imageObjectReference");
        inputDigest = ContractRequirements.requiredText(inputDigest, "inputDigest");
    }
}

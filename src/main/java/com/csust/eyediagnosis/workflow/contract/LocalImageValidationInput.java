package com.csust.eyediagnosis.workflow.contract;

public record LocalImageValidationInput(String workflowId,
                                        String imageObjectReference,
                                        String expectedDigest) implements WorkflowNodeInput {
    public LocalImageValidationInput {
        workflowId = ContractRequirements.requiredText(workflowId, "workflowId");
        imageObjectReference = ContractRequirements.requiredText(imageObjectReference, "imageObjectReference");
        expectedDigest = ContractRequirements.requiredText(expectedDigest, "expectedDigest");
    }
}

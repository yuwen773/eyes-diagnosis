package com.csust.eyediagnosis.workflow.contract;

public record ImageQualityRouteInput(ImageQualitySnapshot quality) implements WorkflowNodeInput {
    public ImageQualityRouteInput {
        quality = ContractRequirements.required(quality, "quality");
    }
}

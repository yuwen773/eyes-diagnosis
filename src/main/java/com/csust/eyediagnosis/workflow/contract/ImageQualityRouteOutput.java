package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.ImageQualityDecision;
import com.csust.eyediagnosis.workflow.domain.ImageQualityReasonCode;

import java.util.Set;

/** A Graph-consumed decision, not a Java routing instruction. */
public record ImageQualityRouteOutput(ImageQualityDecision decision,
                                      Set<ImageQualityReasonCode> reasonCodes) implements WorkflowNodeOutput {
    public ImageQualityRouteOutput {
        decision = ContractRequirements.required(decision, "image quality decision");
        reasonCodes = ContractRequirements.immutableSet(reasonCodes, "quality reason codes");
    }
}

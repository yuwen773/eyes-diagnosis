package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.ImageQualityReasonCode;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;

public record LocalImageValidationOutput(boolean accepted,
                                         String verifiedDigest,
                                         String detectedMediaType,
                                         ImageQualityReasonCode rejectionReason) implements WorkflowNodeOutput {
    public LocalImageValidationOutput {
        verifiedDigest = ContractRequirements.requiredText(verifiedDigest, "verifiedDigest");
        detectedMediaType = ContractRequirements.requiredText(detectedMediaType, "detectedMediaType");
        if (accepted && rejectionReason != null) {
            throw new InvalidWorkflowContractException("accepted image validation cannot include a rejection reason");
        }
        if (!accepted && rejectionReason == null) {
            throw new InvalidWorkflowContractException("rejected image validation requires a rejection reason");
        }
    }
}

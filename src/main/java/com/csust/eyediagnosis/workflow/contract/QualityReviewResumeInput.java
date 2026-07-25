package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.QualityReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewReasonCode;

public record QualityReviewResumeInput(String workflowId,
                                       String reviewTaskId,
                                       long taskVersion,
                                       String reviewerId,
                                       QualityReviewDecision decision,
                                       ReviewReasonCode reasonCode) implements WorkflowNodeInput {
    public QualityReviewResumeInput {
        workflowId = ContractRequirements.requiredText(workflowId, "workflowId");
        reviewTaskId = ContractRequirements.requiredText(reviewTaskId, "reviewTaskId");
        taskVersion = ContractRequirements.nonNegative(taskVersion, "taskVersion");
        reviewerId = ContractRequirements.requiredText(reviewerId, "reviewerId");
        decision = ContractRequirements.required(decision, "quality review decision");
        reasonCode = ContractRequirements.required(reasonCode, "review reason code");
    }
}

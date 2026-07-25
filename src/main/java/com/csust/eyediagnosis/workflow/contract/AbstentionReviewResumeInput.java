package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.AbstentionReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewReasonCode;

public record AbstentionReviewResumeInput(String workflowId,
                                          String reviewTaskId,
                                          long taskVersion,
                                          String reviewerId,
                                          AbstentionReviewDecision decision,
                                          ReviewReasonCode reasonCode) implements WorkflowNodeInput {
    public AbstentionReviewResumeInput {
        workflowId = ContractRequirements.requiredText(workflowId, "workflowId");
        reviewTaskId = ContractRequirements.requiredText(reviewTaskId, "reviewTaskId");
        taskVersion = ContractRequirements.nonNegative(taskVersion, "taskVersion");
        reviewerId = ContractRequirements.requiredText(reviewerId, "reviewerId");
        decision = ContractRequirements.required(decision, "abstention review decision");
        reasonCode = ContractRequirements.required(reasonCode, "review reason code");
    }
}

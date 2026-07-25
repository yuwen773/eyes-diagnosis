package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.ReviewReasonCode;
import com.csust.eyediagnosis.workflow.domain.ValidPredictionReviewDecision;

public record ValidPredictionReviewResumeInput(String workflowId,
                                               String reviewTaskId,
                                               long taskVersion,
                                               String reviewerId,
                                               ValidPredictionReviewDecision decision,
                                               ReviewReasonCode reasonCode) implements WorkflowNodeInput {
    public ValidPredictionReviewResumeInput {
        workflowId = ContractRequirements.requiredText(workflowId, "workflowId");
        reviewTaskId = ContractRequirements.requiredText(reviewTaskId, "reviewTaskId");
        taskVersion = ContractRequirements.nonNegative(taskVersion, "taskVersion");
        reviewerId = ContractRequirements.requiredText(reviewerId, "reviewerId");
        decision = ContractRequirements.required(decision, "valid prediction review decision");
        reasonCode = ContractRequirements.required(reasonCode, "review reason code");
    }
}

package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.ExplanationClaimValidationDecision;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowLimitationReasonCode;

import java.util.Set;

/** Suggested publication state only; a later service owns durable state changes. */
public record ExplanationClaimValidationOutput(ExplanationClaimValidationDecision decision,
                                               ExplanationPublicationStatus suggestedPublicationStatus,
                                               Set<WorkflowLimitationReasonCode> failureReasonCodes,
                                               Set<String> verifiedCitationIds) implements WorkflowNodeOutput {
    public ExplanationClaimValidationOutput {
        decision = ContractRequirements.required(decision, "claim validation decision");
        suggestedPublicationStatus = ContractRequirements.required(suggestedPublicationStatus,
                "suggestedPublicationStatus");
        failureReasonCodes = ContractRequirements.immutableSet(failureReasonCodes, "failureReasonCodes");
        verifiedCitationIds = ContractRequirements.immutableNonBlankSet(verifiedCitationIds, "verifiedCitationIds");
    }
}

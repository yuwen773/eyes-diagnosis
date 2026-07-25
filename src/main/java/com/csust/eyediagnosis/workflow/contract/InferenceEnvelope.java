package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.SafetyAbstentionReasonCode;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;

/**
 * Immutable one-epoch inference result. Every downstream quality and exposure
 * contract references this same envelope rather than performing another RPC.
 */
public record InferenceEnvelope(String workflowId,
                                long inferenceEpoch,
                                String imageObjectReference,
                                String inputDigest,
                                ImageQualitySnapshot quality,
                                InferenceOutcomeType outcomeType,
                                PredictionSnapshot predictionSnapshot,
                                SafetyAbstentionReasonCode safetyAbstentionReasonCode,
                                TechnicalFailureCode technicalFailureCode,
                                boolean outOfDistribution,
                                String modelVersion,
                                String modelFingerprint,
                                String calibrationStatus) {
    public InferenceEnvelope {
        workflowId = ContractRequirements.requiredText(workflowId, "workflowId");
        inferenceEpoch = ContractRequirements.nonNegative(inferenceEpoch, "inferenceEpoch");
        imageObjectReference = ContractRequirements.requiredText(imageObjectReference, "imageObjectReference");
        inputDigest = ContractRequirements.requiredText(inputDigest, "inputDigest");
        quality = ContractRequirements.required(quality, "quality");
        outcomeType = ContractRequirements.required(outcomeType, "outcomeType");
        modelVersion = ContractRequirements.requiredText(modelVersion, "modelVersion");
        modelFingerprint = ContractRequirements.requiredText(modelFingerprint, "modelFingerprint");
        calibrationStatus = ContractRequirements.requiredText(calibrationStatus, "calibrationStatus");
        switch (outcomeType) {
            case VALID_PREDICTION -> {
                if (predictionSnapshot == null || safetyAbstentionReasonCode != null || technicalFailureCode != null) {
                    throw new InvalidWorkflowContractException("VALID_PREDICTION requires only a prediction snapshot");
                }
            }
            case SAFETY_ABSTENTION -> {
                if (safetyAbstentionReasonCode == null || technicalFailureCode != null) {
                    throw new InvalidWorkflowContractException("SAFETY_ABSTENTION requires only a safety abstention reason");
                }
            }
            case TECHNICAL_FAILURE -> {
                if (technicalFailureCode == null || predictionSnapshot != null || safetyAbstentionReasonCode != null) {
                    throw new InvalidWorkflowContractException("TECHNICAL_FAILURE requires only a technical failure code");
                }
            }
        }
    }
}

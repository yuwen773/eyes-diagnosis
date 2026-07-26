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
                                String detectedMediaType,
                                ImageQualitySnapshot quality,
                                InferenceOutcomeType outcomeType,
                                PredictionSnapshot predictionSnapshot,
                                SafetyAbstentionReasonCode safetyAbstentionReasonCode,
                                TechnicalFailureCode technicalFailureCode,
                                OodSnapshot oodSnapshot,
                                CalibrationSnapshot calibrationSnapshot,
                                String modelVersion,
                                String modelFingerprint,
                                String preprocessVersion,
                                String inferencePolicyVersion,
                                String inferredAt) {
    public InferenceEnvelope {
        workflowId = ContractRequirements.requiredText(workflowId, "workflowId");
        inferenceEpoch = ContractRequirements.nonNegative(inferenceEpoch, "inferenceEpoch");
        imageObjectReference = ContractRequirements.requiredText(imageObjectReference, "imageObjectReference");
        inputDigest = ContractRequirements.requiredText(inputDigest, "inputDigest");
        detectedMediaType = ContractRequirements.requiredText(detectedMediaType, "detectedMediaType");
        quality = ContractRequirements.required(quality, "quality");
        outcomeType = ContractRequirements.required(outcomeType, "outcomeType");
        oodSnapshot = ContractRequirements.required(oodSnapshot, "oodSnapshot");
        calibrationSnapshot = ContractRequirements.required(calibrationSnapshot, "calibrationSnapshot");
        modelVersion = ContractRequirements.requiredText(modelVersion, "modelVersion");
        modelFingerprint = ContractRequirements.requiredText(modelFingerprint, "modelFingerprint");
        preprocessVersion = ContractRequirements.requiredText(preprocessVersion, "preprocessVersion");
        inferencePolicyVersion = ContractRequirements.requiredText(inferencePolicyVersion, "inferencePolicyVersion");
        inferredAt = ContractRequirements.requiredText(inferredAt, "inferredAt");
        switch (outcomeType) {
            case VALID_PREDICTION -> {
                if (predictionSnapshot == null || safetyAbstentionReasonCode != null || technicalFailureCode != null) {
                    throw new InvalidWorkflowContractException("VALID_PREDICTION requires only a prediction snapshot");
                }
                if ("not-provided".equals(modelFingerprint)) {
                    throw new InvalidWorkflowContractException("VALID_PREDICTION requires a model fingerprint");
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

    /** Compatibility constructor for the PR-01 contract shape. */
    public InferenceEnvelope(String workflowId, long inferenceEpoch, String imageObjectReference, String inputDigest,
                             ImageQualitySnapshot quality, InferenceOutcomeType outcomeType,
                             PredictionSnapshot predictionSnapshot,
                             SafetyAbstentionReasonCode safetyAbstentionReasonCode,
                             TechnicalFailureCode technicalFailureCode, boolean outOfDistribution,
                             String modelVersion, String modelFingerprint, String calibrationStatus) {
        this(workflowId, inferenceEpoch, imageObjectReference, inputDigest, "application/octet-stream", quality,
                outcomeType, predictionSnapshot, safetyAbstentionReasonCode, technicalFailureCode,
                new OodSnapshot(outOfDistribution, "not-provided", null),
                new CalibrationSnapshot(calibrationStatus, null), modelVersion, modelFingerprint,
                "not-provided", "not-provided", java.time.Instant.EPOCH.toString());
    }
}

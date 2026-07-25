package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SafetyAbstentionReasonCode;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;

/** Safe patient-projection contract derived from the immutable inference envelope. */
public record VisionExposureOutput(InferenceOutcomeType outcomeType,
                                   PredictionExposureStatus exposureStatus,
                                   PatientPredictionProjection predictionProjection,
                                   SafetyAbstentionReasonCode safetyAbstentionReasonCode,
                                   TechnicalFailureCode technicalFailureCode) implements WorkflowNodeOutput {
    public VisionExposureOutput {
        outcomeType = ContractRequirements.required(outcomeType, "outcomeType");
        exposureStatus = ContractRequirements.required(exposureStatus, "exposureStatus");
        boolean mayExpose = outcomeType == InferenceOutcomeType.VALID_PREDICTION
                && exposureStatus == PredictionExposureStatus.AVAILABLE;
        if (mayExpose != (predictionProjection != null)) {
            throw new InvalidWorkflowContractException("prediction projection must exist only for AVAILABLE valid predictions");
        }
        if (outcomeType == InferenceOutcomeType.SAFETY_ABSTENTION
                && (safetyAbstentionReasonCode == null || technicalFailureCode != null)) {
            throw new InvalidWorkflowContractException("SAFETY_ABSTENTION requires only a safety abstention reason");
        }
        if (outcomeType == InferenceOutcomeType.TECHNICAL_FAILURE
                && (technicalFailureCode == null || safetyAbstentionReasonCode != null)) {
            throw new InvalidWorkflowContractException("TECHNICAL_FAILURE requires only a technical failure code");
        }
        if (outcomeType == InferenceOutcomeType.VALID_PREDICTION
                && (safetyAbstentionReasonCode != null || technicalFailureCode != null)) {
            throw new InvalidWorkflowContractException("VALID_PREDICTION cannot carry a failure code");
        }
    }
}

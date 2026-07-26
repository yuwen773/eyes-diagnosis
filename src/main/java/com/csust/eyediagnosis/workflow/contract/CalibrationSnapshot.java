package com.csust.eyediagnosis.workflow.contract;

/** Immutable calibration observation; a missing probability is explicitly represented. */
public record CalibrationSnapshot(String status, Double calibratedProbability) {
    public CalibrationSnapshot {
        status = ContractRequirements.requiredText(status, "calibration status");
        if (calibratedProbability != null) {
            ContractRequirements.probability(calibratedProbability, "calibrated probability");
        }
    }
}

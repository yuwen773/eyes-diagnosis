package com.csust.eyediagnosis.workflow.contract;

/** The restricted prediction shape that may appear in a patient-facing projection. */
public record PatientPredictionProjection(String diseaseCode,
                                          double calibratedProbability) {
    public PatientPredictionProjection {
        diseaseCode = ContractRequirements.requiredText(diseaseCode, "diseaseCode");
        calibratedProbability = ContractRequirements.probability(calibratedProbability, "calibratedProbability");
    }
}

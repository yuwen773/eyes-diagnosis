package com.csust.eyediagnosis.workflow.contract;

/** Internal inference snapshot. Patient exposure remains controlled separately. */
public record PredictionSnapshot(String diseaseCode,
                                 double calibratedProbability,
                                 double topTwoMargin) {
    public PredictionSnapshot {
        diseaseCode = ContractRequirements.requiredText(diseaseCode, "diseaseCode");
        calibratedProbability = ContractRequirements.probability(calibratedProbability, "calibratedProbability");
        topTwoMargin = ContractRequirements.probability(topTwoMargin, "topTwoMargin");
    }
}

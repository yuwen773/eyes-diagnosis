package com.csust.eyediagnosis.workflow.contract;

/** Immutable OOD observation returned by the model protocol. */
public record OodSnapshot(boolean outOfDistribution, String status, Double score) {
    public OodSnapshot {
        status = ContractRequirements.requiredText(status, "ood status");
        if (score != null) {
            ContractRequirements.probability(score, "ood score");
        }
    }
}

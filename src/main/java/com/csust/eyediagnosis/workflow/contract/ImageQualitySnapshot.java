package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.domain.ImageQualityReasonCode;

import java.util.Set;

/** Immutable quality result shared by inference and quality/exposure contracts. */
public record ImageQualitySnapshot(int score,
                                   boolean rejected,
                                   Set<ImageQualityReasonCode> reasonCodes) {
    public ImageQualitySnapshot {
        score = ContractRequirements.range(score, 0, 100, "quality score");
        reasonCodes = ContractRequirements.immutableSet(reasonCodes, "quality reason codes");
    }
}

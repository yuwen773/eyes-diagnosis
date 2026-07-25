package com.csust.eyediagnosis.workflow.domain;

/** Type-safe review decision family. */
public sealed interface ReviewDecision permits QualityReviewDecision,
        ValidPredictionReviewDecision, AbstentionReviewDecision {
}

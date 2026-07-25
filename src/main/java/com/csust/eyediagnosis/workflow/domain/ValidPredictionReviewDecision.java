package com.csust.eyediagnosis.workflow.domain;

public enum ValidPredictionReviewDecision implements ReviewDecision {
    CONFIRM_AI_ASSESSMENT,
    CORRECT_AI_ASSESSMENT,
    INCONCLUSIVE
}

package com.csust.eyediagnosis.workflow;

import com.csust.eyediagnosis.workflow.domain.AbstentionReviewDecision;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.QualityReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.domain.ValidPredictionReviewDecision;
import com.csust.eyediagnosis.workflow.exception.InvalidReviewDecisionException;
import com.csust.eyediagnosis.workflow.policy.ReviewDecisionCompatibilityGuard;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ReviewDecisionCompatibilityGuardTest {
    private final ReviewDecisionCompatibilityGuard guard = new ReviewDecisionCompatibilityGuard();

    @Test
    void acceptsOnlyTheDecisionFamilyForEachReviewContext() {
        assertDoesNotThrow(() -> guard.requireDecisionAllowed(ReviewType.IMAGE_QUALITY_GATE,
                InferenceOutcomeType.VALID_PREDICTION, QualityReviewDecision.APPROVE_CONTINUE));
        assertDoesNotThrow(() -> guard.requireDecisionAllowed(ReviewType.FINAL_CLINICAL_REVIEW,
                InferenceOutcomeType.VALID_PREDICTION, ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT));
        assertDoesNotThrow(() -> guard.requireDecisionAllowed(ReviewType.FINAL_CLINICAL_REVIEW,
                InferenceOutcomeType.SAFETY_ABSTENTION, AbstentionReviewDecision.CONFIRM_ABSTENTION));
    }

    @Test
    void rejectsIncompatibleOrTechnicalFailureReviewDecisions() {
        assertThrows(InvalidReviewDecisionException.class,
                () -> guard.requireDecisionAllowed(ReviewType.IMAGE_QUALITY_GATE,
                        InferenceOutcomeType.VALID_PREDICTION, ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT));
        assertThrows(InvalidReviewDecisionException.class,
                () -> guard.requireDecisionAllowed(ReviewType.FINAL_CLINICAL_REVIEW,
                        InferenceOutcomeType.VALID_PREDICTION, AbstentionReviewDecision.CONFIRM_ABSTENTION));
        assertThrows(InvalidReviewDecisionException.class,
                () -> guard.requireDecisionAllowed(ReviewType.FINAL_CLINICAL_REVIEW,
                        InferenceOutcomeType.SAFETY_ABSTENTION, ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT));
        assertThrows(InvalidReviewDecisionException.class,
                () -> guard.requireDecisionAllowed(ReviewType.IMAGE_QUALITY_GATE,
                        InferenceOutcomeType.TECHNICAL_FAILURE, QualityReviewDecision.REJECT_RESUBMIT));
    }
}

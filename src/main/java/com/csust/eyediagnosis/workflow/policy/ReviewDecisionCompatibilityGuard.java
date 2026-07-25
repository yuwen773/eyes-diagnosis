package com.csust.eyediagnosis.workflow.policy;

import com.csust.eyediagnosis.workflow.domain.AbstentionReviewDecision;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.QualityReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.domain.ValidPredictionReviewDecision;
import com.csust.eyediagnosis.workflow.exception.InvalidReviewDecisionException;

import java.util.Objects;

/** Validates action vocabulary against a pre-existing review context. */
public final class ReviewDecisionCompatibilityGuard {
    public void requireDecisionAllowed(ReviewType reviewType,
                                       InferenceOutcomeType inferenceOutcomeType,
                                       ReviewDecision decision) {
        Objects.requireNonNull(reviewType, "review type must not be null");
        Objects.requireNonNull(inferenceOutcomeType, "inference outcome type must not be null");
        Objects.requireNonNull(decision, "review decision must not be null");
        if (inferenceOutcomeType == InferenceOutcomeType.TECHNICAL_FAILURE) {
            throw new InvalidReviewDecisionException("TECHNICAL_FAILURE cannot create or accept a review decision");
        }
        boolean compatible = switch (reviewType) {
            case IMAGE_QUALITY_GATE -> decision instanceof QualityReviewDecision;
            case FINAL_CLINICAL_REVIEW -> switch (inferenceOutcomeType) {
                case VALID_PREDICTION -> decision instanceof ValidPredictionReviewDecision;
                case SAFETY_ABSTENTION -> decision instanceof AbstentionReviewDecision;
                case TECHNICAL_FAILURE -> false;
            };
        };
        if (!compatible) {
            throw new InvalidReviewDecisionException("Review decision is incompatible with review type "
                    + reviewType + " and inference outcome " + inferenceOutcomeType);
        }
    }
}

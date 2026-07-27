package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.ReviewType;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ReviewAuthorizationGuardTest {
    private final ReviewAuthorizationGuard guard = new ReviewAuthorizationGuard();

    @Test
    void grantedReviewerOfAnotherPatientsCaseIsAuthorized() {
        assertDoesNotThrow(() -> guard.requireAuthorized(
                new ReviewerPrincipal(200, Set.of(ReviewType.FINAL_CLINICAL_REVIEW)), ReviewType.FINAL_CLINICAL_REVIEW, 100L));
    }

    @Test
    void reviewerWithoutTheMatchingGrantIsRejected() {
        assertThrows(UnauthorizedReviewActionException.class, () -> guard.requireAuthorized(
                new ReviewerPrincipal(200, Set.of(ReviewType.IMAGE_QUALITY_GATE)), ReviewType.FINAL_CLINICAL_REVIEW, 100L));
    }

    @Test
    void doctorMustNeverReviewTheirOwnWorkflow() {
        assertThrows(UnauthorizedReviewActionException.class, () -> guard.requireAuthorized(
                new ReviewerPrincipal(200, Set.of(ReviewType.FINAL_CLINICAL_REVIEW)), ReviewType.FINAL_CLINICAL_REVIEW, 200L));
    }
}

package com.csust.eyediagnosis.workflow.api;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.review.ReviewerPrincipal;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pure unit tests for the PR-10 API security gate. No Spring context.
 */
class WorkflowApiExposureGuardTest {

    private final WorkflowApiExposureGuard guard = new WorkflowApiExposureGuard();

    private User user(long id, String role) {
        User u = new User();
        u.setId(id);
        u.setUserRole(role);
        return u;
    }

    private User owner() {
        return user(1L, "user");
    }

    private User stranger() {
        return user(2L, "user");
    }

    private User doctor() {
        return user(3L, "doctor");
    }

    private User admin() {
        return user(4L, "admin");
    }

    private DiagnosisWorkflowEntity workflowOwnedBy(long ownerUserId) {
        DiagnosisWorkflowEntity e = new DiagnosisWorkflowEntity();
        e.setWorkflowId("wf_1");
        e.setOwnerUserId(ownerUserId);
        return e;
    }

    @Test
    void ownerCanReadOwnWorkflow() {
        assertDoesNotThrow(() -> guard.assertWorkflowReadable(workflowOwnedBy(1L), owner()));
    }

    @Test
    void doctorCanReadAnyWorkflow() {
        assertDoesNotThrow(() -> guard.assertWorkflowReadable(workflowOwnedBy(1L), doctor()));
    }

    @Test
    void adminCanReadAnyWorkflow() {
        assertDoesNotThrow(() -> guard.assertWorkflowReadable(workflowOwnedBy(1L), admin()));
    }

    @Test
    void strangerCannotReadOthersWorkflow() {
        assertThrows(BusinessException.class,
                () -> guard.assertWorkflowReadable(workflowOwnedBy(1L), stranger()));
    }

    @Test
    void patientCannotViewEnvelope() {
        assertThrows(BusinessException.class, () -> guard.assertCanViewEnvelope(owner()));
    }

    @Test
    void doctorCanViewEnvelope() {
        assertDoesNotThrow(() -> guard.assertCanViewEnvelope(doctor()));
    }

    @Test
    void adminCanViewEnvelope() {
        assertDoesNotThrow(() -> guard.assertCanViewEnvelope(admin()));
    }

    @Test
    void patientCannotReview() {
        assertThrows(BusinessException.class, () -> guard.assertReviewCapable(owner()));
    }

    @Test
    void doctorCanReview() {
        assertDoesNotThrow(() -> guard.assertReviewCapable(doctor()));
    }

    @Test
    void reviewerPrincipalGrantsBothTypesForDoctor() {
        ReviewerPrincipal principal = guard.toReviewerPrincipal(doctor());
        assertTrue(principal.grantedReviewTypes().contains(ReviewType.IMAGE_QUALITY_GATE));
        assertTrue(principal.grantedReviewTypes().contains(ReviewType.FINAL_CLINICAL_REVIEW));
    }

    @Test
    void reviewerPrincipalEmptyForPatient() {
        ReviewerPrincipal principal = guard.toReviewerPrincipal(owner());
        assertTrue(principal.grantedReviewTypes().isEmpty());
    }
}

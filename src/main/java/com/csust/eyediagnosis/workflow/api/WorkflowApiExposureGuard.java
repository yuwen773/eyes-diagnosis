package com.csust.eyediagnosis.workflow.api;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.enums.UserRole;
import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.review.ReviewerPrincipal;
import org.springframework.stereotype.Component;

import java.util.EnumSet;
import java.util.Set;

/**
 * Central API-level security gate for the workflow REST surface (PR-10).
 *
 * <p>Responsibilities (per the PR-10 security spec):
 * <ul>
 *   <li>A patient may only read their own workflow and their own (projection) result.</li>
 *   <li>A doctor may read any workflow (for clinical review), view the full inference
 *       envelope / evidence, and claim/submit review tasks they are authorized for.</li>
 *   <li>An admin may read any workflow and envelope for audit, but does not perform review.</li>
 * </ul>
 *
 * <p>This guard only performs the <em>API-level</em> exposure decisions. The detailed
 * optimistic-lock / ownership enforcement for review actions still lives inside
 * {@code HumanReviewTaskService}; this guard ensures the caller is the right kind of actor
 * before delegating.
 */
@Component
public class WorkflowApiExposureGuard {

    public void assertWorkflowReadable(DiagnosisWorkflowEntity workflow, User loginUser) {
        UserRole role = resolveRole(loginUser);
        boolean owner = workflow.getOwnerUserId() != null && workflow.getOwnerUserId().equals(loginUser.getId());
        if (owner || role == UserRole.DOCTOR || role == UserRole.ADMIN) {
            return;
        }
        throw new BusinessException(ErrorCode.FORBIDDEN_ERROR, "无权访问该诊断工作流");
    }

    public void assertCanViewEnvelope(User loginUser) {
        UserRole role = resolveRole(loginUser);
        if (role == UserRole.DOCTOR || role == UserRole.ADMIN) {
            return;
        }
        throw new BusinessException(ErrorCode.FORBIDDEN_ERROR, "仅医生或管理员可查看完整推理结果");
    }

    public void assertReviewCapable(User loginUser) {
        UserRole role = resolveRole(loginUser);
        if (role == UserRole.DOCTOR) {
            return;
        }
        throw new BusinessException(ErrorCode.FORBIDDEN_ERROR, "仅医生可处理人工审核任务");
    }

    public ReviewerPrincipal toReviewerPrincipal(User loginUser) {
        UserRole role = resolveRole(loginUser);
        Set<ReviewType> granted = (role == UserRole.DOCTOR)
                ? EnumSet.of(ReviewType.IMAGE_QUALITY_GATE, ReviewType.FINAL_CLINICAL_REVIEW)
                : EnumSet.noneOf(ReviewType.class);
        return new ReviewerPrincipal(loginUser.getId(), granted);
    }

    private UserRole resolveRole(User loginUser) {
        return UserRole.getEnumByValue(loginUser.getUserRole());
    }
}

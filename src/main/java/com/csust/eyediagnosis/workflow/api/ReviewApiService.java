package com.csust.eyediagnosis.workflow.api;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.workflow.SubmitReviewDecisionRequest;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.workflow.ReviewSubmissionVO;
import com.csust.eyediagnosis.model.vo.workflow.ReviewTaskSummaryVO;
import com.csust.eyediagnosis.workflow.domain.AbstentionReviewDecision;
import com.csust.eyediagnosis.workflow.domain.QualityReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewReasonCode;
import com.csust.eyediagnosis.workflow.domain.ValidPredictionReviewDecision;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.mapper.HumanReviewTaskMapper;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.review.ClaimReviewTaskCommand;
import com.csust.eyediagnosis.workflow.review.HumanReviewTaskService;
import com.csust.eyediagnosis.workflow.review.ReviewerPrincipal;
import com.csust.eyediagnosis.workflow.review.ReviewTaskStatus;
import com.csust.eyediagnosis.workflow.review.SubmitReviewDecisionCommand;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * API-side orchestration for human review. Delegates all state transitions to the frozen
 * {@link HumanReviewTaskService} (PR-09) — this layer only resolves the caller into a
 * {@link ReviewerPrincipal}, maps the wire decision string to the domain decision and applies
 * the API-level capability gate.
 */
@Service
public class ReviewApiService {

    private final HumanReviewTaskMapper humanReviewTaskMapper;
    private final DiagnosisWorkflowRepository workflowRepository;
    private final HumanReviewTaskService humanReviewTaskService;
    private final WorkflowApiExposureGuard guard;

    public ReviewApiService(HumanReviewTaskMapper humanReviewTaskMapper,
                            DiagnosisWorkflowRepository workflowRepository,
                            HumanReviewTaskService humanReviewTaskService,
                            WorkflowApiExposureGuard guard) {
        this.humanReviewTaskMapper = humanReviewTaskMapper;
        this.workflowRepository = workflowRepository;
        this.humanReviewTaskService = humanReviewTaskService;
        this.guard = guard;
    }

    public List<ReviewTaskSummaryVO> listOpenTasks(User loginUser) {
        guard.assertReviewCapable(loginUser);
        return humanReviewTaskMapper.selectList(new LambdaQueryWrapper<HumanReviewTaskEntity>()
                        .eq(HumanReviewTaskEntity::getStatus, ReviewTaskStatus.OPEN.name()))
                .stream()
                .map(task -> {
                    ReviewTaskSummaryVO vo = new ReviewTaskSummaryVO();
                    vo.setTaskId(task.getReviewTaskId());
                    vo.setWorkflowId(task.getWorkflowId());
                    vo.setReason(task.getReviewType());
                    return vo;
                })
                .toList();
    }

    public void claimTask(String taskId, User loginUser) {
        guard.assertReviewCapable(loginUser);
        HumanReviewTaskEntity task = requireTask(taskId);
        ReviewerPrincipal reviewer = guard.toReviewerPrincipal(loginUser);
        humanReviewTaskService.claim(new ClaimReviewTaskCommand(taskId, reviewer, task.getTaskVersion()));
    }

    public ReviewSubmissionVO submitTask(String taskId, SubmitReviewDecisionRequest request, User loginUser) {
        guard.assertReviewCapable(loginUser);
        HumanReviewTaskEntity task = requireTask(taskId);
        DiagnosisWorkflowEntity workflow = workflowRepository.findByWorkflowId(task.getWorkflowId())
                .orElseThrow(() -> new BusinessException(ErrorCode.NOT_FOUND_ERROR, "诊断工作流不存在"));

        ReviewDecision decision = resolveDecision(request.getDecision());
        ReviewReasonCode reasonCode = resolveReasonCode(decision);
        ReviewerPrincipal reviewer = guard.toReviewerPrincipal(loginUser);

        com.csust.eyediagnosis.workflow.review.ReviewSubmissionResult result =
                humanReviewTaskService.submit(new SubmitReviewDecisionCommand(
                        taskId, reviewer, task.getTaskVersion(), workflow.getWorkflowVersion(), decision, reasonCode));

        ReviewSubmissionVO vo = new ReviewSubmissionVO();
        vo.setTaskId(result.reviewTaskId());
        vo.setWorkflowId(result.workflowId());
        vo.setCommittedWorkflowVersion(result.committedWorkflowVersion());
        vo.setResumeJobId(result.resumeJobId());
        return vo;
    }

    private HumanReviewTaskEntity requireTask(String taskId) {
        HumanReviewTaskEntity task = humanReviewTaskMapper.selectById(taskId);
        if (task == null) {
            throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "审核任务不存在");
        }
        return task;
    }

    private ReviewDecision resolveDecision(String decision) {
        if (decision == null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "缺少审核决定");
        }
        try {
            return ValidPredictionReviewDecision.valueOf(decision);
        } catch (IllegalArgumentException ignore) {
            // continue
        }
        try {
            return AbstentionReviewDecision.valueOf(decision);
        } catch (IllegalArgumentException ignore) {
            // continue
        }
        try {
            return QualityReviewDecision.valueOf(decision);
        } catch (IllegalArgumentException ignore) {
            // continue
        }
        throw new BusinessException(ErrorCode.PARAMS_ERROR, "不支持的审核决定: " + decision);
    }

    private ReviewReasonCode resolveReasonCode(ReviewDecision decision) {
        if (decision instanceof QualityReviewDecision d) {
            return switch (d) {
                case APPROVE_CONTINUE -> ReviewReasonCode.QUALITY_APPROVED;
                case REJECT_RESUBMIT -> ReviewReasonCode.QUALITY_REJECTED;
            };
        }
        if (decision instanceof ValidPredictionReviewDecision d) {
            return switch (d) {
                case CONFIRM_AI_ASSESSMENT -> ReviewReasonCode.AI_ASSESSMENT_CONFIRMED;
                case CORRECT_AI_ASSESSMENT -> ReviewReasonCode.AI_ASSESSMENT_CORRECTED;
                case INCONCLUSIVE -> ReviewReasonCode.INCONCLUSIVE;
            };
        }
        if (decision instanceof AbstentionReviewDecision d) {
            return switch (d) {
                case CONFIRM_ABSTENTION -> ReviewReasonCode.ABSTENTION_CONFIRMED;
                case PROVIDE_INDEPENDENT_REVIEW -> ReviewReasonCode.INDEPENDENT_REVIEW_PROVIDED;
                case INCONCLUSIVE -> ReviewReasonCode.INCONCLUSIVE;
            };
        }
        throw new BusinessException(ErrorCode.PARAMS_ERROR, "无法确定审核决定的原因码");
    }
}

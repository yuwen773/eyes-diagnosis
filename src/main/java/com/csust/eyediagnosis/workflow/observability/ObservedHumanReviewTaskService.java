package com.csust.eyediagnosis.workflow.observability;

import com.csust.eyediagnosis.workflow.audit.AuditEventType;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditEventDraft;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditRecorder;
import com.csust.eyediagnosis.workflow.domain.QualityReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewDecision;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.HumanReviewTaskRepository;
import com.csust.eyediagnosis.workflow.review.ClaimReviewTaskCommand;
import com.csust.eyediagnosis.workflow.review.DefaultHumanReviewTaskService;
import com.csust.eyediagnosis.workflow.review.HumanReviewTaskService;
import com.csust.eyediagnosis.workflow.review.ReviewSubmissionResult;
import com.csust.eyediagnosis.workflow.review.SubmitReviewDecisionCommand;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;

/**
 * PR-12.1/12.2 observation decorator around the frozen human review service. Records the
 * REVIEW_ASSIGNED / REVIEW_COMPLETED audit events plus review_duration_seconds and
 * review_reject_total. The decision matrix and every state transition remain in the delegate.
 */
@Service
@Primary
public class ObservedHumanReviewTaskService implements HumanReviewTaskService {

    private static final Logger log = LoggerFactory.getLogger(ObservedHumanReviewTaskService.class);

    private final DefaultHumanReviewTaskService delegate;
    private final WorkflowAuditRecorder auditRecorder;
    private final WorkflowMetrics metrics;
    private final HumanReviewTaskRepository taskRepository;

    public ObservedHumanReviewTaskService(DefaultHumanReviewTaskService delegate,
                                          WorkflowAuditRecorder auditRecorder,
                                          WorkflowMetrics metrics,
                                          HumanReviewTaskRepository taskRepository) {
        this.delegate = delegate;
        this.auditRecorder = auditRecorder;
        this.metrics = metrics;
        this.taskRepository = taskRepository;
    }

    @Override
    public void claim(ClaimReviewTaskCommand command) {
        delegate.claim(command);
        observeSafely(() -> taskRepository.findById(command.reviewTaskId()).ifPresent(task ->
                auditRecorder.append(new WorkflowAuditEventDraft(task.getWorkflowId(), AuditEventType.REVIEW_ASSIGNED,
                        "DOCTOR", String.valueOf(command.reviewer().reviewerUserId()), task.getReviewType(),
                        "{\"reviewTaskId\":\"" + task.getReviewTaskId() + "\"}"))));
    }

    @Override
    public ReviewSubmissionResult submit(SubmitReviewDecisionCommand command) {
        ReviewSubmissionResult result = delegate.submit(command);
        observeSafely(() -> {
            auditRecorder.append(new WorkflowAuditEventDraft(result.workflowId(), AuditEventType.REVIEW_COMPLETED,
                    "DOCTOR", String.valueOf(command.reviewer().reviewerUserId()), null,
                    "{\"reviewTaskId\":\"" + result.reviewTaskId() + "\",\"decision\":\""
                            + command.decision() + "\",\"reasonCode\":\"" + command.reasonCode().name() + "\"}"));
            if (isReject(command.decision())) {
                metrics.reviewRejected();
            }
            taskRepository.findById(command.reviewTaskId()).ifPresent(this::recordReviewDuration);
        });
        return result;
    }

    @Override
    public void cancel(String reviewTaskId, long expectedTaskVersion) {
        delegate.cancel(reviewTaskId, expectedTaskVersion);
    }

    private void recordReviewDuration(HumanReviewTaskEntity task) {
        LocalDateTime createdAt = task.getCreatedAt();
        if (createdAt != null) {
            metrics.reviewDuration(Duration.between(createdAt, LocalDateTime.now()));
        }
    }

    private static boolean isReject(ReviewDecision decision) {
        return decision == QualityReviewDecision.REJECT_RESUBMIT;
    }

    private void observeSafely(Runnable observation) {
        try {
            observation.run();
        } catch (RuntimeException exception) {
            metrics.auditWriteFailed();
            log.error("review audit observation failed after a durable review transition; "
                    + "business state is unaffected.", exception);
        }
    }
}

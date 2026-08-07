package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRecoveryToken;
import com.csust.eyediagnosis.workflow.job.JobCreationResult;
import com.csust.eyediagnosis.workflow.job.NewWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobCreationService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.InferenceEnvelopeEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.HumanReviewTaskRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.InferenceEnvelopeRepository;
import com.csust.eyediagnosis.workflow.contract.RecordEventCommand;
import com.csust.eyediagnosis.workflow.contract.WorkflowEventBuilder;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowStateMutator;
import com.csust.eyediagnosis.workflow.policy.ReviewDecisionCompatibilityGuard;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Runs the review-decision transaction from PLAN-001 §4.4; it never executes the graph. */
@Service
public class DefaultHumanReviewTaskService implements HumanReviewTaskService {
    static final int RESUME_JOB_MAX_ATTEMPTS = 3;
    static final String DECISION_EVENT_TYPE = "HUMAN_REVIEW_DECISION_SUBMITTED";
    static final String DOCTOR_ACTOR_TYPE = "DOCTOR";

    private final HumanReviewTaskRepository taskRepository;
    private final DiagnosisWorkflowRepository workflowRepository;
    private final InferenceEnvelopeRepository envelopeRepository;
    private final WorkflowStateMutator workflowStateMutator;
    private final WorkflowJobCreationService jobCreationService;
    private final ReviewAuthorizationGuard authorizationGuard = new ReviewAuthorizationGuard();
    private final ReviewDecisionCompatibilityGuard compatibilityGuard = new ReviewDecisionCompatibilityGuard();

    public DefaultHumanReviewTaskService(HumanReviewTaskRepository taskRepository,
                                         DiagnosisWorkflowRepository workflowRepository,
                                         InferenceEnvelopeRepository envelopeRepository,
                                         WorkflowJobCreationService jobCreationService,
                                         WorkflowStateMutator workflowStateMutator) {
        this.taskRepository = taskRepository;
        this.workflowRepository = workflowRepository;
        this.envelopeRepository = envelopeRepository;
        this.workflowStateMutator = workflowStateMutator;
        this.jobCreationService = jobCreationService;
    }

    @Override
    @Transactional
    public void claim(ClaimReviewTaskCommand command) {
        HumanReviewTaskEntity task = requireTask(command.reviewTaskId());
        if (ReviewTaskStatus.valueOf(task.getStatus()) != ReviewTaskStatus.OPEN) {
            throw new ReviewTaskStateException("Review task " + task.getReviewTaskId() + " is not open for claiming");
        }
        DiagnosisWorkflowEntity workflow = requireWorkflow(task.getWorkflowId());
        authorizationGuard.requireAuthorized(command.reviewer(), ReviewType.valueOf(task.getReviewType()),
                workflow.getOwnerUserId());
        if (taskRepository.claimIfVersionMatches(task.getReviewTaskId(), command.expectedTaskVersion(),
                command.reviewer().reviewerUserId()) != 1) {
            throw new ReviewTaskConflictException("Review task claim lost a concurrent update");
        }
    }

    @Override
    @Transactional
    public ReviewSubmissionResult submit(SubmitReviewDecisionCommand command) {
        HumanReviewTaskEntity task = requireTask(command.reviewTaskId());
        if (ReviewTaskStatus.valueOf(task.getStatus()) != ReviewTaskStatus.CLAIMED) {
            throw new ReviewTaskStateException("Review task " + task.getReviewTaskId() + " has no claimed reviewer");
        }
        if (task.getAssignedDoctorId() == null || task.getAssignedDoctorId() != command.reviewer().reviewerUserId()) {
            throw new UnauthorizedReviewActionException("Only the claiming doctor may submit this review task");
        }
        DiagnosisWorkflowEntity workflow = requireWorkflow(task.getWorkflowId());
        if (WorkflowStatus.valueOf(workflow.getStatus()) != WorkflowStatus.WAITING_HUMAN_REVIEW) {
            throw new ReviewTaskStateException("Workflow " + workflow.getWorkflowId() + " is not waiting for human review");
        }
        if (workflow.getWorkflowVersion() != command.expectedWorkflowVersion()) {
            throw new ReviewTaskConflictException("Workflow version conflict");
        }
        ReviewType reviewType = ReviewType.valueOf(task.getReviewType());
        authorizationGuard.requireAuthorized(command.reviewer(), reviewType, workflow.getOwnerUserId());
        compatibilityGuard.requireDecisionAllowed(reviewType, requireOutcomeType(workflow), command.decision());

        if (taskRepository.submitDecisionIfVersionMatches(task.getReviewTaskId(), command.expectedTaskVersion(),
                command.reviewer().reviewerUserId(), decisionCode(command), command.reasonCode().name()) != 1) {
            throw new ReviewTaskConflictException("Review decision submission lost a concurrent update");
        }
        SegmentCode resumeSegment = HumanReviewHandoff.resumeSegmentFor(reviewType);
        if (workflowStateMutator.transitionStatus(workflow.getWorkflowId(), command.expectedWorkflowVersion(),
                WorkflowStatus.WAITING_HUMAN_REVIEW, WorkflowStatus.RUNNING, resumeSegment.name()) != 1) {
            throw new ReviewTaskConflictException("Workflow version conflict");
        }
        String resumeJobId = createResumeJob(workflow, task, resumeSegment);
        appendDecisionEvent(command, workflow, resumeSegment);
        return new ReviewSubmissionResult(task.getReviewTaskId(), workflow.getWorkflowId(),
                command.expectedWorkflowVersion() + 1, resumeJobId);
    }

    @Override
    @Transactional
    public void cancel(String reviewTaskId, long expectedTaskVersion) {
        HumanReviewTaskEntity task = requireTask(reviewTaskId);
        if (!ReviewTaskStatus.valueOf(task.getStatus()).isActive()) {
            throw new ReviewTaskStateException("Review task " + reviewTaskId + " is no longer active");
        }
        if (taskRepository.cancelIfVersionMatches(reviewTaskId, expectedTaskVersion) != 1) {
            throw new ReviewTaskConflictException("Review task cancellation lost a concurrent update");
        }
    }

    private HumanReviewTaskEntity requireTask(String reviewTaskId) {
        return taskRepository.findById(reviewTaskId)
                .orElseThrow(() -> new ReviewTaskNotFoundException("Review task " + reviewTaskId + " does not exist"));
    }

    private DiagnosisWorkflowEntity requireWorkflow(String workflowId) {
        return workflowRepository.findByWorkflowId(workflowId)
                .orElseThrow(() -> new ReviewTaskStateException("Workflow " + workflowId + " does not exist"));
    }

    private InferenceOutcomeType requireOutcomeType(DiagnosisWorkflowEntity workflow) {
        InferenceEnvelopeEntity envelope = envelopeRepository
                .findByWorkflowIdAndEpoch(workflow.getWorkflowId(), workflow.getInferenceEpoch())
                .orElseThrow(() -> new ReviewTaskStateException("Workflow " + workflow.getWorkflowId()
                        + " has no inference envelope for epoch " + workflow.getInferenceEpoch()));
        return InferenceOutcomeType.valueOf(envelope.getInferenceOutcomeType());
    }

    private String createResumeJob(DiagnosisWorkflowEntity workflow, HumanReviewTaskEntity task, SegmentCode resumeSegment) {
        JobCreationResult creation = jobCreationService.createIfAbsent(new NewWorkflowJob(workflow.getWorkflowId(),
                workflow.getInferenceEpoch(), resumeSegment, WorkflowJobType.RESUME_SEGMENT, RESUME_JOB_MAX_ATTEMPTS,
                new GraphRecoveryToken(task.getGraphThreadId(), task.getGraphCheckpointId())));
        if (creation.status() != JobCreationResult.Status.CREATED) {
            throw new ReviewTaskConflictException("Conflicting resume job already exists");
        }
        return creation.jobId();
    }

    private void appendDecisionEvent(SubmitReviewDecisionCommand command, DiagnosisWorkflowEntity workflow,
                                     SegmentCode resumeSegment) {
        RecordEventCommand cmd = WorkflowEventBuilder.decisionEvent(workflow.getWorkflowId(),
                command.reviewTaskId(), decisionCode(command),
                String.valueOf(command.reviewer().reviewerUserId()),
                command.expectedWorkflowVersion(), resumeSegment.name(), command.reasonCode().name());
        workflowStateMutator.recordEvent(cmd);
    }

    private static String decisionCode(SubmitReviewDecisionCommand command) {
        return String.valueOf(command.decision());
    }
}

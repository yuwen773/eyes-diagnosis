package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.job.JobCreationResult;
import com.csust.eyediagnosis.workflow.job.NewWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobCreationService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import com.csust.eyediagnosis.workflow.policy.ExplanationPublicationGuard;
import com.csust.eyediagnosis.workflow.policy.WorkflowLifecycleGuard;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
public class DefaultGraphSegmentCommitCoordinator implements GraphSegmentCommitCoordinator {
    private final DiagnosisWorkflowRepository workflowRepository;
    private final WorkflowJobRepository jobRepository;
    private final WorkflowEventRepository eventRepository;
    private final WorkflowJobCreationService jobCreationService;
    private final SegmentBusinessDeltaDispatcher deltaDispatcher;
    private final SegmentCommitFailpoint failpoint;
    private final WorkflowLifecycleGuard lifecycleGuard = new WorkflowLifecycleGuard();
    private final ExplanationPublicationGuard publicationGuard = new ExplanationPublicationGuard();

    @Autowired
    public DefaultGraphSegmentCommitCoordinator(DiagnosisWorkflowRepository workflowRepository,
                                                WorkflowJobRepository jobRepository,
                                                WorkflowEventRepository eventRepository,
                                                WorkflowJobCreationService jobCreationService,
                                                SegmentBusinessDeltaDispatcher deltaDispatcher) {
        this(workflowRepository, jobRepository, eventRepository, jobCreationService, deltaDispatcher,
                new NoOpSegmentCommitFailpoint());
    }

    public DefaultGraphSegmentCommitCoordinator(DiagnosisWorkflowRepository workflowRepository,
                                                WorkflowJobRepository jobRepository,
                                                WorkflowEventRepository eventRepository,
                                                WorkflowJobCreationService jobCreationService,
                                                SegmentBusinessDeltaDispatcher deltaDispatcher,
                                                SegmentCommitFailpoint failpoint) {
        this.workflowRepository = workflowRepository;
        this.jobRepository = jobRepository;
        this.eventRepository = eventRepository;
        this.jobCreationService = jobCreationService;
        this.deltaDispatcher = deltaDispatcher;
        this.failpoint = failpoint;
    }

    @Override
    @Transactional
    public SegmentCommitResult commit(GraphSegmentExecutionRequest request, SegmentExecutionResult result) {
        if (!request.workflowId().equals(result.workflowId()) || !request.graphBinding().equals(result.graphBinding())
                || request.segmentCode() != result.executedSegment()) {
            throw new SegmentCommitFailureException("Execution result does not belong to its commit request");
        }
        WorkflowJobEntity currentJob = requireLiveFence(request);
        DiagnosisWorkflowEntity workflow = workflowRepository.findByWorkflowId(request.workflowId())
                .orElseThrow(() -> new SegmentCommitFailureException("Workflow does not exist"));
        requireExactWorkflowBinding(request, workflow);
        SegmentBusinessCommitPlan plan = result.businessCommitPlan();
        validatePlan(workflow, plan);

        deltaDispatcher.persist(plan.businessDelta());
        if (workflowRepository.updateStateIfExactBindingAndVersionMatches(request.workflowId(), request.expectedWorkflowVersion(),
                workflow.getStatus(), request.graphBinding().definitionVersion(), request.graphBinding().definitionHash(),
                request.graphBinding().actionVersion(), plan.targetWorkflowStatus().name(), plan.persistedCurrentSegment().name(),
                plan.publicationStatus().name(), plan.exposureStatus().name(), plan.stopReasonCode(), plan.limitationReasonCode()) != 1) {
            throw new SegmentCommitFailureException("Workflow version conflict");
        }
        appendEvent(request, plan);
        if (jobRepository.markSucceededIfLeaseMatches(request.fence().jobId(), request.fence().leaseOwner(),
                request.fence().leaseToken(), request.fence().leaseVersion()) != 1) {
            throw new SegmentCommitLeaseLostException("Lease lost before segment commit");
        }
        failpoint.beforeResumeJobCreation();
        String nextJobId = createResumeJobIfNeeded(request, result, currentJob.getMaxAttempts());
        return new SegmentCommitResult(request.workflowId(), request.expectedWorkflowVersion() + 1,
                request.fence().jobId(), nextJobId);
    }

    private WorkflowJobEntity requireLiveFence(GraphSegmentExecutionRequest request) {
        WorkflowJobEntity job = jobRepository.findById(request.fence().jobId())
                .orElseThrow(() -> new SegmentCommitFailureException("Current job does not exist"));
        if (!request.workflowId().equals(job.getWorkflowId()) || !WorkflowJobStatus.LEASED.name().equals(job.getStatus())
                || !request.fence().leaseOwner().equals(job.getLeaseOwner())
                || !request.fence().leaseToken().equals(job.getLeaseToken())
                || request.fence().leaseVersion() != job.getLeaseVersion()
                || job.getLeaseUntil() == null || !job.getLeaseUntil().isAfter(LocalDateTime.now())) {
            throw new SegmentCommitLeaseLostException("Lease is no longer valid");
        }
        return job;
    }

    private static void requireExactWorkflowBinding(GraphSegmentExecutionRequest request, DiagnosisWorkflowEntity workflow) {
        if (workflow.getWorkflowVersion() != request.expectedWorkflowVersion()) {
            throw new SegmentCommitFailureException("Workflow version conflict");
        }
        if (WorkflowStatus.valueOf(workflow.getStatus()).isTerminal()) {
            throw new SegmentCommitFailureException("Workflow is already terminal");
        }
        if (!request.graphBinding().definitionVersion().equals(workflow.getGraphDefinitionVersion())
                || !request.graphBinding().definitionHash().equals(workflow.getGraphDefinitionHash())
                || !request.graphBinding().actionVersion().equals(workflow.getActionVersion())) {
            throw new SegmentCommitFailureException("Workflow graph binding mismatch");
        }
    }

    private void validatePlan(DiagnosisWorkflowEntity workflow, SegmentBusinessCommitPlan plan) {
        lifecycleGuard.requireTransitionAllowed(WorkflowStatus.valueOf(workflow.getStatus()), plan.targetWorkflowStatus());
        ExplanationPublicationStatus currentPublication = ExplanationPublicationStatus.valueOf(workflow.getExplanationPublicationStatus());
        if (currentPublication != plan.publicationStatus()) {
            publicationGuard.requireTransitionAllowed(currentPublication, plan.publicationStatus());
        }
    }

    private void appendEvent(GraphSegmentExecutionRequest request, SegmentBusinessCommitPlan plan) {
        WorkflowEventDraft draft = plan.event();
        DiagnosisWorkflowEventEntity event = new DiagnosisWorkflowEventEntity();
        event.setEventId(UUID.randomUUID().toString());
        event.setWorkflowId(request.workflowId());
        event.setEventSequence(request.expectedWorkflowVersion() + 1);
        event.setEventType(draft.eventType());
        event.setActorType(draft.actorType());
        event.setActorId(draft.actorId());
        event.setWorkflowVersion(request.expectedWorkflowVersion() + 1);
        event.setSegmentCode(plan.persistedCurrentSegment().name());
        event.setReasonCode(draft.reasonCode());
        event.setPayloadSnapshot(draft.payloadSnapshot());
        eventRepository.append(event);
    }

    private String createResumeJobIfNeeded(GraphSegmentExecutionRequest request, SegmentExecutionResult result, int maxAttempts) {
        if (result.disposition() == GraphRuntimeDisposition.COMPLETED) {
            return null;
        }
        JobCreationResult creation = jobCreationService.createIfAbsent(new NewWorkflowJob(request.workflowId(),
                request.executionEpoch(), result.nextSegment(), WorkflowJobType.RESUME_SEGMENT, maxAttempts,
                result.recoveryToken()));
        if (creation.status() != JobCreationResult.Status.CREATED) {
            throw new SegmentCommitFailureException("Conflicting resume job already exists");
        }
        return creation.jobId();
    }
}

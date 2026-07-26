package com.csust.eyediagnosis.workflow.runtime;

import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.runtime.EmptySegmentInput;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRuntimeExecutionException;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentCommitCoordinator;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentExecutionRequest;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentRuntimeAdapter;
import com.csust.eyediagnosis.workflow.graph.runtime.ResumeGraphSegmentRequest;
import com.csust.eyediagnosis.workflow.graph.runtime.StartGraphSegmentRequest;
import com.csust.eyediagnosis.workflow.job.ControlledJobErrorCode;
import com.csust.eyediagnosis.workflow.job.JobRetryResult;
import com.csust.eyediagnosis.workflow.job.LeasedWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobRetryService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import org.springframework.stereotype.Service;

@Service
public class DefaultClaimedSegmentExecutionService implements ClaimedSegmentExecutionService {
    private final DiagnosisWorkflowRepository workflowRepository;
    private final GraphSegmentRuntimeAdapter runtimeAdapter;
    private final GraphSegmentCommitCoordinator commitCoordinator;
    private final WorkflowJobRetryService retryService;

    public DefaultClaimedSegmentExecutionService(DiagnosisWorkflowRepository workflowRepository,
                                                 GraphSegmentRuntimeAdapter runtimeAdapter,
                                                 GraphSegmentCommitCoordinator commitCoordinator,
                                                 WorkflowJobRetryService retryService) {
        this.workflowRepository = workflowRepository;
        this.runtimeAdapter = runtimeAdapter;
        this.commitCoordinator = commitCoordinator;
        this.retryService = retryService;
    }

    @Override
    public SegmentExecutionAttemptResult execute(LeasedWorkflowJob job) {
        try {
            DiagnosisWorkflowEntity workflow = workflowRepository.findByWorkflowId(job.workflowId())
                    .orElseThrow(() -> new IllegalArgumentException("Workflow does not exist: " + job.workflowId()));
            GraphSegmentExecutionRequest request = requestFor(job, workflow);
            commitCoordinator.commit(request, runtimeAdapter.execute(request));
            return new SegmentExecutionAttemptResult(SegmentExecutionAttemptResult.Status.COMMITTED, "COMMITTED");
        } catch (GraphRuntimeExecutionException exception) {
            JobRetryResult retry = retryService.scheduleRetry(job.fence(), ControlledJobErrorCode.GRAPH_RUNTIME_FAILURE);
            return new SegmentExecutionAttemptResult(switch (retry) {
                case RETRY_SCHEDULED -> SegmentExecutionAttemptResult.Status.RETRY_SCHEDULED;
                case RETRY_EXHAUSTED -> SegmentExecutionAttemptResult.Status.RETRY_EXHAUSTED;
                case LEASE_LOST -> SegmentExecutionAttemptResult.Status.LEASE_LOST;
            }, exception.getMessage());
        } catch (com.csust.eyediagnosis.workflow.graph.runtime.SegmentCommitLeaseLostException exception) {
            return new SegmentExecutionAttemptResult(SegmentExecutionAttemptResult.Status.LEASE_LOST,
                    exception.getMessage());
        } catch (RuntimeException exception) {
            return new SegmentExecutionAttemptResult(SegmentExecutionAttemptResult.Status.CONTRACT_REJECTED,
                    exception.getMessage());
        }
    }

    private static GraphSegmentExecutionRequest requestFor(LeasedWorkflowJob job, DiagnosisWorkflowEntity workflow) {
        GraphDefinitionBinding binding = new GraphDefinitionBinding(workflow.getGraphDefinitionVersion(),
                workflow.getGraphDefinitionHash(), workflow.getActionVersion());
        if (job.jobType() == WorkflowJobType.START_SEGMENT) {
            return new StartGraphSegmentRequest(job.workflowId(), workflow.getWorkflowVersion(), job.fence(), binding,
                    job.segmentCode(), job.executionEpoch(), new EmptySegmentInput());
        }
        if (job.recoveryToken() == null) {
            throw new IllegalArgumentException("Resume job is missing its exact graph recovery token");
        }
        return new ResumeGraphSegmentRequest(job.workflowId(), workflow.getWorkflowVersion(), job.fence(), binding,
                job.segmentCode(), job.executionEpoch(), job.recoveryToken(), new EmptySegmentInput());
    }
}

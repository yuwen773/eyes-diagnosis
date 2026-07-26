package com.csust.eyediagnosis.workflow.runtime;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.runtime.EmptySegmentInput;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRecoveryToken;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRuntimeDisposition;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRuntimeExecutionException;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentCommitCoordinator;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentExecutionRequest;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentRuntimeAdapter;
import com.csust.eyediagnosis.workflow.graph.runtime.NoBusinessDelta;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentBusinessCommitPlan;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentCommitLeaseLostException;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentExecutionResult;
import com.csust.eyediagnosis.workflow.graph.runtime.WorkflowEventDraft;
import com.csust.eyediagnosis.workflow.job.JobRetryResult;
import com.csust.eyediagnosis.workflow.job.LeasedWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobRetryService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ClaimedSegmentExecutionServiceTest {
    @Test
    void startsWithoutRecoveryTokenAndCommitsTheRuntimeResult() {
        DiagnosisWorkflowRepository workflows = configuredWorkflowRepository();
        GraphSegmentRuntimeAdapter runtime = mock(GraphSegmentRuntimeAdapter.class);
        GraphSegmentCommitCoordinator coordinator = mock(GraphSegmentCommitCoordinator.class);
        DefaultClaimedSegmentExecutionService service = service(workflows, runtime, coordinator, mock(WorkflowJobRetryService.class));
        LeasedWorkflowJob job = startJob();
        when(runtime.execute(any())).thenReturn(result());

        SegmentExecutionAttemptResult attempt = service.execute(job);

        assertEquals(SegmentExecutionAttemptResult.Status.COMMITTED, attempt.status());
        verify(runtime).execute(any(GraphSegmentExecutionRequest.class));
        verify(coordinator).commit(any(), any());
    }

    @Test
    void resumesOnlyWithTheExactPersistedRecoveryToken() {
        DiagnosisWorkflowRepository workflows = configuredWorkflowRepository();
        GraphSegmentRuntimeAdapter runtime = mock(GraphSegmentRuntimeAdapter.class);
        GraphSegmentCommitCoordinator coordinator = mock(GraphSegmentCommitCoordinator.class);
        DefaultClaimedSegmentExecutionService service = service(workflows, runtime, coordinator, mock(WorkflowJobRetryService.class));
        LeasedWorkflowJob job = new LeasedWorkflowJob("resume", "wf", WorkflowJobType.RESUME_SEGMENT,
                SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, 0, 1, 3, "worker", "token", 1,
                Instant.now().plusSeconds(30), new GraphRecoveryToken("thread", "checkpoint"));
        when(runtime.execute(any())).thenReturn(result());

        assertEquals(SegmentExecutionAttemptResult.Status.COMMITTED, service.execute(job).status());
        verify(runtime).execute(any(com.csust.eyediagnosis.workflow.graph.runtime.ResumeGraphSegmentRequest.class));
    }

    @Test
    void rejectsResumeWithoutTokenBeforeRuntimeOrCommit() {
        DiagnosisWorkflowRepository workflows = configuredWorkflowRepository();
        GraphSegmentRuntimeAdapter runtime = mock(GraphSegmentRuntimeAdapter.class);
        GraphSegmentCommitCoordinator coordinator = mock(GraphSegmentCommitCoordinator.class);
        DefaultClaimedSegmentExecutionService service = service(workflows, runtime, coordinator, mock(WorkflowJobRetryService.class));
        LeasedWorkflowJob job = new LeasedWorkflowJob("resume", "wf", WorkflowJobType.RESUME_SEGMENT,
                SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, 0, 1, 3, "worker", "token", 1,
                Instant.now().plusSeconds(30));

        assertEquals(SegmentExecutionAttemptResult.Status.CONTRACT_REJECTED, service.execute(job).status());
        verify(runtime, never()).execute(any());
        verify(coordinator, never()).commit(any(), any());
    }

    @Test
    void schedulesRetryForGraphTechnicalFailureWithoutCommitting() {
        DiagnosisWorkflowRepository workflows = configuredWorkflowRepository();
        GraphSegmentRuntimeAdapter runtime = mock(GraphSegmentRuntimeAdapter.class);
        GraphSegmentCommitCoordinator coordinator = mock(GraphSegmentCommitCoordinator.class);
        WorkflowJobRetryService retry = mock(WorkflowJobRetryService.class);
        DefaultClaimedSegmentExecutionService service = service(workflows, runtime, coordinator, retry);
        doThrow(new GraphRuntimeExecutionException("checkpoint unavailable", null)).when(runtime).execute(any());
        when(retry.scheduleRetry(any(), any())).thenReturn(JobRetryResult.RETRY_SCHEDULED);

        assertEquals(SegmentExecutionAttemptResult.Status.RETRY_SCHEDULED, service.execute(startJob()).status());
        verify(coordinator, never()).commit(any(), any());
    }

    @Test
    void returnsLeaseLostWithoutReplayingTheGraphWhenCommitFenceRejects() {
        DiagnosisWorkflowRepository workflows = configuredWorkflowRepository();
        GraphSegmentRuntimeAdapter runtime = mock(GraphSegmentRuntimeAdapter.class);
        GraphSegmentCommitCoordinator coordinator = mock(GraphSegmentCommitCoordinator.class);
        DefaultClaimedSegmentExecutionService service = service(workflows, runtime, coordinator, mock(WorkflowJobRetryService.class));
        when(runtime.execute(any())).thenReturn(result());
        doThrow(new SegmentCommitLeaseLostException("lease lost")).when(coordinator).commit(any(), any());

        assertEquals(SegmentExecutionAttemptResult.Status.LEASE_LOST, service.execute(startJob()).status());
        verify(runtime).execute(any());
        verify(coordinator).commit(any(), any());
    }

    private static DefaultClaimedSegmentExecutionService service(DiagnosisWorkflowRepository workflows,
                                                                  GraphSegmentRuntimeAdapter runtime,
                                                                  GraphSegmentCommitCoordinator coordinator,
                                                                  WorkflowJobRetryService retry) {
        return new DefaultClaimedSegmentExecutionService(workflows, runtime, coordinator, retry);
    }

    private static DiagnosisWorkflowRepository configuredWorkflowRepository() {
        DiagnosisWorkflowRepository workflows = mock(DiagnosisWorkflowRepository.class);
        DiagnosisWorkflowEntity workflow = new DiagnosisWorkflowEntity();
        workflow.setWorkflowId("wf");
        workflow.setWorkflowVersion(3L);
        workflow.setGraphDefinitionVersion("v");
        workflow.setGraphDefinitionHash("h");
        workflow.setActionVersion("a");
        when(workflows.findByWorkflowId("wf")).thenReturn(Optional.of(workflow));
        return workflows;
    }

    private static LeasedWorkflowJob startJob() {
        return new LeasedWorkflowJob("job", "wf", WorkflowJobType.START_SEGMENT, SegmentCode.INTAKE_INFERENCE_QUALITY,
                0, 1, 3, "worker", "token", 1, Instant.now().plusSeconds(30));
    }

    private static SegmentExecutionResult result() {
        return new SegmentExecutionResult("wf", SegmentCode.INTAKE_INFERENCE_QUALITY, GraphRuntimeDisposition.COMPLETED,
                "__END__", null, null, new GraphDefinitionBinding("v", "h", "a"),
                new SegmentBusinessCommitPlan(WorkflowStatus.COMPLETED_LIMITED, SegmentCode.INTAKE_INFERENCE_QUALITY,
                        ExplanationPublicationStatus.NONE, PredictionExposureStatus.NOT_AVAILABLE, null, null,
                        new NoBusinessDelta(), new WorkflowEventDraft("SEGMENT", "SYSTEM", "test", null, null)));
    }
}

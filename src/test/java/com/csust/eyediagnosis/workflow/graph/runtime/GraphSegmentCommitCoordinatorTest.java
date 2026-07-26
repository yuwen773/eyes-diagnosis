package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.*;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.job.*;
import com.csust.eyediagnosis.workflow.persistence.entity.*;
import com.csust.eyediagnosis.workflow.persistence.repository.*;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class GraphSegmentCommitCoordinatorTest {
    @Test void nonTerminalCommitUpdatesExactlyOnceAndCreatesOneResumeJob() {
        DiagnosisWorkflowRepository workflows=mock(DiagnosisWorkflowRepository.class); WorkflowJobRepository jobs=mock(WorkflowJobRepository.class);
        WorkflowEventRepository events=mock(WorkflowEventRepository.class); WorkflowJobCreationService creation=mock(WorkflowJobCreationService.class);
        DefaultGraphSegmentCommitCoordinator coordinator=new DefaultGraphSegmentCommitCoordinator(workflows,jobs,events,creation,new DefaultSegmentBusinessDeltaDispatcher(java.util.List.of()));
        GraphSegmentExecutionRequest request=request(); when(jobs.findById("job")).thenReturn(Optional.of(job())); when(workflows.findByWorkflowId("wf")).thenReturn(Optional.of(workflow()));
        when(workflows.updateStateIfExactBindingAndVersionMatches(anyString(),anyLong(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),nullable(String.class),nullable(String.class))).thenReturn(1);
        when(jobs.markSucceededIfLeaseMatches(anyString(),anyString(),anyString(),anyLong())).thenReturn(1);
        when(creation.createIfAbsent(any())).thenReturn(new JobCreationResult(JobCreationResult.Status.CREATED,"resume"));
        SegmentCommitResult result=coordinator.commit(request, interrupted());
        assertEquals(4,result.committedWorkflowVersion()); assertEquals("resume",result.nextResumeJobId());
        verify(events).append(any(DiagnosisWorkflowEventEntity.class)); verify(creation).createIfAbsent(argThat(j -> j.recoveryToken().equals(new GraphRecoveryToken("thread","checkpoint"))));
    }
    @Test void secondCommitIsRejectedBeforeAnotherBusinessMutation() {
        DiagnosisWorkflowRepository workflows=mock(DiagnosisWorkflowRepository.class); WorkflowJobRepository jobs=mock(WorkflowJobRepository.class);
        DefaultGraphSegmentCommitCoordinator coordinator=new DefaultGraphSegmentCommitCoordinator(workflows,jobs,mock(WorkflowEventRepository.class),mock(WorkflowJobCreationService.class),new DefaultSegmentBusinessDeltaDispatcher(java.util.List.of()));
        when(jobs.findById("job")).thenReturn(Optional.of(job())); DiagnosisWorkflowEntity changed=workflow(); changed.setWorkflowVersion(4L); when(workflows.findByWorkflowId("wf")).thenReturn(Optional.of(changed));
        assertThrows(SegmentCommitFailureException.class,()->coordinator.commit(request(),interrupted())); verify(workflows,never()).updateStateIfExactBindingAndVersionMatches(anyString(),anyLong(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString());
    }
    @Test void terminalCommitNeverCreatesAResumeJob() {
        DiagnosisWorkflowRepository workflows=mock(DiagnosisWorkflowRepository.class); WorkflowJobRepository jobs=mock(WorkflowJobRepository.class);
        WorkflowEventRepository events=mock(WorkflowEventRepository.class); WorkflowJobCreationService creation=mock(WorkflowJobCreationService.class);
        DefaultGraphSegmentCommitCoordinator coordinator=new DefaultGraphSegmentCommitCoordinator(workflows,jobs,events,creation,new DefaultSegmentBusinessDeltaDispatcher(java.util.List.of()));
        when(jobs.findById("job")).thenReturn(Optional.of(job())); when(workflows.findByWorkflowId("wf")).thenReturn(Optional.of(workflow()));
        when(workflows.updateStateIfExactBindingAndVersionMatches(anyString(),anyLong(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),nullable(String.class),nullable(String.class))).thenReturn(1);
        when(jobs.markSucceededIfLeaseMatches(anyString(),anyString(),anyString(),anyLong())).thenReturn(1);
        SegmentExecutionResult completed=new SegmentExecutionResult("wf",SegmentCode.INTAKE_INFERENCE_QUALITY,GraphRuntimeDisposition.COMPLETED,"__END__",null,null,new GraphDefinitionBinding("v","h","a"),new SegmentBusinessCommitPlan(WorkflowStatus.COMPLETED_LIMITED,SegmentCode.INTAKE_INFERENCE_QUALITY,ExplanationPublicationStatus.NONE,PredictionExposureStatus.NOT_AVAILABLE,null,null,new NoBusinessDelta(),new WorkflowEventDraft("SEGMENT","SYSTEM","test",null,null)));

        SegmentCommitResult result=coordinator.commit(request(),completed);

        assertEquals(4,result.committedWorkflowVersion()); assertNull(result.nextResumeJobId()); verify(events).append(any(DiagnosisWorkflowEventEntity.class)); verify(creation,never()).createIfAbsent(any());
    }
    @Test void liveFenceRejectionDoesNotMutateWorkflowOrAppendAnEvent() {
        DiagnosisWorkflowRepository workflows=mock(DiagnosisWorkflowRepository.class); WorkflowJobRepository jobs=mock(WorkflowJobRepository.class); WorkflowEventRepository events=mock(WorkflowEventRepository.class);
        WorkflowJobEntity expired=job(); expired.setLeaseUntil(LocalDateTime.now().minusMinutes(1)); when(jobs.findById("job")).thenReturn(Optional.of(expired));
        DefaultGraphSegmentCommitCoordinator coordinator=new DefaultGraphSegmentCommitCoordinator(workflows,jobs,events,mock(WorkflowJobCreationService.class),new DefaultSegmentBusinessDeltaDispatcher(java.util.List.of()));

        assertThrows(SegmentCommitLeaseLostException.class,()->coordinator.commit(request(),interrupted()));
        verifyNoInteractions(workflows,events);
    }
    @Test void failpointRunsAfterCurrentJobSuccessBeforeResumeCreation() {
        DiagnosisWorkflowRepository workflows=mock(DiagnosisWorkflowRepository.class); WorkflowJobRepository jobs=mock(WorkflowJobRepository.class); WorkflowEventRepository events=mock(WorkflowEventRepository.class); WorkflowJobCreationService creation=mock(WorkflowJobCreationService.class);
        DefaultGraphSegmentCommitCoordinator coordinator=new DefaultGraphSegmentCommitCoordinator(workflows,jobs,events,creation,new DefaultSegmentBusinessDeltaDispatcher(java.util.List.of()),()->{throw new IllegalStateException("test rollback");});
        when(jobs.findById("job")).thenReturn(Optional.of(job())); when(workflows.findByWorkflowId("wf")).thenReturn(Optional.of(workflow()));
        when(workflows.updateStateIfExactBindingAndVersionMatches(anyString(),anyLong(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),nullable(String.class),nullable(String.class))).thenReturn(1);
        when(jobs.markSucceededIfLeaseMatches(anyString(),anyString(),anyString(),anyLong())).thenReturn(1);

        assertThrows(IllegalStateException.class,()->coordinator.commit(request(),interrupted()));
        verify(creation,never()).createIfAbsent(any());
    }
    private static GraphSegmentExecutionRequest request(){return new StartGraphSegmentRequest("wf",3,new LeasedJobFence("job","worker","token",1,1),new GraphDefinitionBinding("v","h","a"),SegmentCode.INTAKE_INFERENCE_QUALITY,0,new EmptySegmentInput());}
    private static SegmentExecutionResult interrupted(){return new SegmentExecutionResult("wf",SegmentCode.INTAKE_INFERENCE_QUALITY,GraphRuntimeDisposition.INTERRUPTED,"next",SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION,new GraphRecoveryToken("thread","checkpoint"),new GraphDefinitionBinding("v","h","a"),plan());}
    private static SegmentBusinessCommitPlan plan(){return new SegmentBusinessCommitPlan(WorkflowStatus.WAITING_HUMAN_REVIEW,SegmentCode.INTAKE_INFERENCE_QUALITY,ExplanationPublicationStatus.NONE,PredictionExposureStatus.NOT_AVAILABLE,null,null,new NoBusinessDelta(),new WorkflowEventDraft("SEGMENT","SYSTEM","test",null,null));}
    private static WorkflowJobEntity job(){WorkflowJobEntity j=new WorkflowJobEntity();j.setJobId("job");j.setWorkflowId("wf");j.setStatus(WorkflowJobStatus.LEASED.name());j.setLeaseOwner("worker");j.setLeaseToken("token");j.setLeaseVersion(1L);j.setLeaseUntil(LocalDateTime.now().plusMinutes(1));j.setMaxAttempts(3);return j;}
    private static DiagnosisWorkflowEntity workflow(){DiagnosisWorkflowEntity w=new DiagnosisWorkflowEntity();w.setWorkflowId("wf");w.setStatus("RUNNING");w.setWorkflowVersion(3L);w.setGraphDefinitionVersion("v");w.setGraphDefinitionHash("h");w.setActionVersion("a");w.setExplanationPublicationStatus("NONE");w.setPredictionExposureStatus("NOT_AVAILABLE");return w;}
}

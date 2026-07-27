package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.*;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;
import com.csust.eyediagnosis.workflow.job.WorkflowJobCreationService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import com.csust.eyediagnosis.workflow.review.HumanReviewHandoff;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** A commit that stops at a human node hands off to a review task and never self-resumes. */
class HumanReviewBoundaryCommitTest {
    record Handoff(String workflowId, ReviewType reviewType, GraphRecoveryToken token) { }

    static final class RecordingHandoff implements HumanReviewHandoff {
        final List<Handoff> handoffs = new ArrayList<>();

        @Override
        public String createHandoffTask(String workflowId, ReviewType reviewType, GraphRecoveryToken recoveryToken) {
            handoffs.add(new Handoff(workflowId, reviewType, recoveryToken));
            return "task-" + handoffs.size();
        }
    }

    @Test
    void qualityBoundaryCreatesQualityReviewTaskInsteadOfResumeJob() {
        assertHumanBoundaryHandsOff(SegmentCode.QUALITY_REVIEW_RESUME, "imageQualityHumanReview", ReviewType.IMAGE_QUALITY_GATE);
    }

    @Test
    void finalReviewBoundaryCreatesFinalReviewTaskInsteadOfResumeJob() {
        assertHumanBoundaryHandsOff(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME, "finalClinicalReview", ReviewType.FINAL_CLINICAL_REVIEW);
    }

    @Test
    void coordinatorWiredWithoutReviewSupportRejectsHumanBoundaries() {
        DiagnosisWorkflowRepository workflows = mock(DiagnosisWorkflowRepository.class);
        WorkflowJobRepository jobs = mock(WorkflowJobRepository.class);
        WorkflowEventRepository events = mock(WorkflowEventRepository.class);
        WorkflowJobCreationService creation = mock(WorkflowJobCreationService.class);
        DefaultGraphSegmentCommitCoordinator coordinator = new DefaultGraphSegmentCommitCoordinator(workflows, jobs,
                events, creation, new DefaultSegmentBusinessDeltaDispatcher(List.of()));
        stubHappyPath(workflows, jobs);

        assertThrows(SegmentCommitFailureException.class,
                () -> coordinator.commit(request(), interrupted(SegmentCode.QUALITY_REVIEW_RESUME, "imageQualityHumanReview")));
        verify(creation, never()).createIfAbsent(any());
    }

    private void assertHumanBoundaryHandsOff(SegmentCode nextSegment, String publicNextNode, ReviewType expectedType) {
        DiagnosisWorkflowRepository workflows = mock(DiagnosisWorkflowRepository.class);
        WorkflowJobRepository jobs = mock(WorkflowJobRepository.class);
        WorkflowEventRepository events = mock(WorkflowEventRepository.class);
        WorkflowJobCreationService creation = mock(WorkflowJobCreationService.class);
        RecordingHandoff handoff = new RecordingHandoff();
        DefaultGraphSegmentCommitCoordinator coordinator = new DefaultGraphSegmentCommitCoordinator(workflows, jobs,
                events, creation, new DefaultSegmentBusinessDeltaDispatcher(List.of()), new NoOpSegmentCommitFailpoint(), handoff);
        stubHappyPath(workflows, jobs);

        SegmentCommitResult result = coordinator.commit(request(), interrupted(nextSegment, publicNextNode));

        assertEquals(4, result.committedWorkflowVersion());
        assertNull(result.nextResumeJobId());
        assertEquals(List.of(new Handoff("wf", expectedType, new GraphRecoveryToken("thread", "checkpoint"))), handoff.handoffs);
        verify(creation, never()).createIfAbsent(any());
        verify(events).append(any(DiagnosisWorkflowEventEntity.class));
    }

    private static void stubHappyPath(DiagnosisWorkflowRepository workflows, WorkflowJobRepository jobs) {
        when(jobs.findById("job")).thenReturn(Optional.of(job()));
        when(workflows.findByWorkflowId("wf")).thenReturn(Optional.of(workflow()));
        when(workflows.updateStateIfExactBindingAndVersionMatches(anyString(), anyLong(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), nullable(String.class),
                nullable(String.class))).thenReturn(1);
        when(jobs.markSucceededIfLeaseMatches(anyString(), anyString(), anyString(), anyLong())).thenReturn(1);
    }

    private static GraphSegmentExecutionRequest request() {
        return new StartGraphSegmentRequest("wf", 3, new LeasedJobFence("job", "worker", "token", 1, 1),
                new GraphDefinitionBinding("v", "h", "a"), SegmentCode.INTAKE_INFERENCE_QUALITY, 0, new EmptySegmentInput());
    }

    private static SegmentExecutionResult interrupted(SegmentCode nextSegment, String publicNextNode) {
        return new SegmentExecutionResult("wf", SegmentCode.INTAKE_INFERENCE_QUALITY, GraphRuntimeDisposition.INTERRUPTED,
                publicNextNode, nextSegment, new GraphRecoveryToken("thread", "checkpoint"),
                new GraphDefinitionBinding("v", "h", "a"), plan());
    }

    private static SegmentBusinessCommitPlan plan() {
        return new SegmentBusinessCommitPlan(WorkflowStatus.WAITING_HUMAN_REVIEW, SegmentCode.INTAKE_INFERENCE_QUALITY,
                ExplanationPublicationStatus.NONE, PredictionExposureStatus.NOT_AVAILABLE, null, null,
                new NoBusinessDelta(), new WorkflowEventDraft("SEGMENT", "SYSTEM", "test", null, null));
    }

    private static WorkflowJobEntity job() {
        WorkflowJobEntity j = new WorkflowJobEntity();
        j.setJobId("job"); j.setWorkflowId("wf"); j.setStatus(WorkflowJobStatus.LEASED.name());
        j.setLeaseOwner("worker"); j.setLeaseToken("token"); j.setLeaseVersion(1L);
        j.setLeaseUntil(LocalDateTime.now().plusMinutes(1)); j.setMaxAttempts(3);
        return j;
    }

    private static DiagnosisWorkflowEntity workflow() {
        DiagnosisWorkflowEntity w = new DiagnosisWorkflowEntity();
        w.setWorkflowId("wf"); w.setStatus("RUNNING"); w.setWorkflowVersion(3L);
        w.setGraphDefinitionVersion("v"); w.setGraphDefinitionHash("h"); w.setActionVersion("a");
        w.setExplanationPublicationStatus("NONE"); w.setPredictionExposureStatus("NOT_AVAILABLE");
        return w;
    }
}

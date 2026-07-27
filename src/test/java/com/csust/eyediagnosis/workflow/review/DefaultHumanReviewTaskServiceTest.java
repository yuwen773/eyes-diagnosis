package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.AbstentionReviewDecision;
import com.csust.eyediagnosis.workflow.domain.QualityReviewDecision;
import com.csust.eyediagnosis.workflow.domain.ReviewReasonCode;
import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.ValidPredictionReviewDecision;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.exception.InvalidReviewDecisionException;
import com.csust.eyediagnosis.workflow.job.JobCreationResult;
import com.csust.eyediagnosis.workflow.job.NewWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobCreationService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.InferenceEnvelopeEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.HumanReviewTaskRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.InferenceEnvelopeRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DefaultHumanReviewTaskServiceTest {
    private static final String TASK_ID = "task-1";
    private static final String WORKFLOW_ID = "wf-1";
    private static final long PATIENT_ID = 100L;
    private static final long DOCTOR_ID = 200L;

    private final HumanReviewTaskRepository taskRepository = mock(HumanReviewTaskRepository.class);
    private final DiagnosisWorkflowRepository workflowRepository = mock(DiagnosisWorkflowRepository.class);
    private final InferenceEnvelopeRepository envelopeRepository = mock(InferenceEnvelopeRepository.class);
    private final WorkflowEventRepository eventRepository = mock(WorkflowEventRepository.class);
    private final WorkflowJobCreationService jobCreationService = mock(WorkflowJobCreationService.class);
    private final DefaultHumanReviewTaskService service = new DefaultHumanReviewTaskService(
            taskRepository, workflowRepository, envelopeRepository, eventRepository, jobCreationService);

    // ---- claim ----

    @Test
    void openTaskCanBeClaimedByAnAuthorizedDoctor() {
        stubTask(task("OPEN", ReviewType.FINAL_CLINICAL_REVIEW, 0L, null));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 3L));
        when(taskRepository.claimIfVersionMatches(TASK_ID, 0L, DOCTOR_ID)).thenReturn(1);

        assertDoesNotThrow(() -> service.claim(new ClaimReviewTaskCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 0L)));
        verify(taskRepository).claimIfVersionMatches(TASK_ID, 0L, DOCTOR_ID);
    }

    @Test
    void claimedTaskCannotBeClaimedAgain() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, 300L));

        assertThrows(ReviewTaskStateException.class, () -> service.claim(new ClaimReviewTaskCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L)));
        verify(taskRepository, never()).claimIfVersionMatches(anyString(), anyLong(), anyLong());
    }

    @Test
    void workflowOwnerCannotClaimTheirOwnReviewTask() {
        stubTask(task("OPEN", ReviewType.FINAL_CLINICAL_REVIEW, 0L, null));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 3L));

        assertThrows(UnauthorizedReviewActionException.class, () -> service.claim(new ClaimReviewTaskCommand(TASK_ID,
                reviewer(PATIENT_ID, ReviewType.FINAL_CLINICAL_REVIEW), 0L)));
        verify(taskRepository, never()).claimIfVersionMatches(anyString(), anyLong(), anyLong());
    }

    @Test
    void staleClaimVersionLosesTheCompareAndSet() {
        stubTask(task("OPEN", ReviewType.IMAGE_QUALITY_GATE, 2L, null));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 3L));
        when(taskRepository.claimIfVersionMatches(TASK_ID, 1L, DOCTOR_ID)).thenReturn(0);

        assertThrows(ReviewTaskConflictException.class, () -> service.claim(new ClaimReviewTaskCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.IMAGE_QUALITY_GATE), 1L)));
    }

    @Test
    void missingTaskIsReportedAsNotFound() {
        when(taskRepository.findById(TASK_ID)).thenReturn(Optional.empty());

        assertThrows(ReviewTaskNotFoundException.class, () -> service.claim(new ClaimReviewTaskCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.IMAGE_QUALITY_GATE), 0L)));
    }

    // ---- submit: accepted decisions ----

    @Test
    void qualityApprovalResumesTheQualityGateSegmentWithTheTaskCheckpoint() {
        stubTask(task("CLAIMED", ReviewType.IMAGE_QUALITY_GATE, 1L, DOCTOR_ID));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 3L));
        stubEnvelope("VALID_PREDICTION");
        stubAcceptingCas(SegmentCode.QUALITY_REVIEW_RESUME);
        when(jobCreationService.createIfAbsent(any())).thenReturn(new JobCreationResult(JobCreationResult.Status.CREATED, "job-1"));

        ReviewSubmissionResult result = service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.IMAGE_QUALITY_GATE), 1L, 3L,
                QualityReviewDecision.APPROVE_CONTINUE, ReviewReasonCode.QUALITY_APPROVED));

        assertEquals("job-1", result.resumeJobId());
        assertEquals(4L, result.committedWorkflowVersion());
        ArgumentCaptor<NewWorkflowJob> jobCaptor = ArgumentCaptor.forClass(NewWorkflowJob.class);
        verify(jobCreationService).createIfAbsent(jobCaptor.capture());
        NewWorkflowJob job = jobCaptor.getValue();
        assertEquals(SegmentCode.QUALITY_REVIEW_RESUME, job.segmentCode());
        assertEquals(WorkflowJobType.RESUME_SEGMENT, job.jobType());
        assertEquals("thread-1", job.recoveryToken().threadId());
        assertEquals("checkpoint-1", job.recoveryToken().checkpointId());
        verify(taskRepository).submitDecisionIfVersionMatches(TASK_ID, 1L, DOCTOR_ID,
                "APPROVE_CONTINUE", "QUALITY_APPROVED");
        ArgumentCaptor<DiagnosisWorkflowEventEntity> eventCaptor = ArgumentCaptor.forClass(DiagnosisWorkflowEventEntity.class);
        verify(eventRepository).append(eventCaptor.capture());
        DiagnosisWorkflowEventEntity event = eventCaptor.getValue();
        assertEquals(DefaultHumanReviewTaskService.DECISION_EVENT_TYPE, event.getEventType());
        assertEquals(4L, event.getWorkflowVersion());
        assertEquals(String.valueOf(DOCTOR_ID), event.getActorId());
    }

    @Test
    void correctedAssessmentResumesFinalReviewWithoutNewRetrieval() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, DOCTOR_ID));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 5L));
        stubEnvelope("VALID_PREDICTION");
        stubAcceptingCas(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME);
        when(jobCreationService.createIfAbsent(any())).thenReturn(new JobCreationResult(JobCreationResult.Status.CREATED, "job-2"));

        service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L, 5L,
                ValidPredictionReviewDecision.CORRECT_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CORRECTED));

        ArgumentCaptor<NewWorkflowJob> jobCaptor = ArgumentCaptor.forClass(NewWorkflowJob.class);
        verify(jobCreationService).createIfAbsent(jobCaptor.capture());
        // A corrected assessment only resumes the final-review segment; it never re-enters retrieval.
        assertEquals(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME, jobCaptor.getValue().segmentCode());
    }

    @Test
    void abstentionCaseAcceptsTheAbstentionVocabulary() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, DOCTOR_ID));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 5L));
        stubEnvelope("SAFETY_ABSTENTION");
        stubAcceptingCas(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME);
        when(jobCreationService.createIfAbsent(any())).thenReturn(new JobCreationResult(JobCreationResult.Status.CREATED, "job-3"));

        assertDoesNotThrow(() -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L, 5L,
                AbstentionReviewDecision.CONFIRM_ABSTENTION, ReviewReasonCode.ABSTENTION_CONFIRMED)));
    }

    // ---- submit: action matrix rejections ----

    @Test
    void qualityGateCannotConfirmADisease() {
        stubTask(task("CLAIMED", ReviewType.IMAGE_QUALITY_GATE, 1L, DOCTOR_ID));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 3L));
        stubEnvelope("VALID_PREDICTION");

        assertThrows(InvalidReviewDecisionException.class, () -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.IMAGE_QUALITY_GATE), 1L, 3L,
                ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CONFIRMED)));
        verifyNoDecisionPersisted();
    }

    @Test
    void abstentionCaseRejectsValidPredictionVocabulary() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, DOCTOR_ID));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 5L));
        stubEnvelope("SAFETY_ABSTENTION");

        assertThrows(InvalidReviewDecisionException.class, () -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L, 5L,
                ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CONFIRMED)));
        verifyNoDecisionPersisted();
    }

    // ---- submit: authorization and state ----

    @Test
    void onlyTheClaimingDoctorMaySubmitTheDecision() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, 300L));

        assertThrows(UnauthorizedReviewActionException.class, () -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L, 3L,
                ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CONFIRMED)));
        verifyNoDecisionPersisted();
    }

    @Test
    void unclaimedTaskCannotAcceptADecision() {
        stubTask(task("OPEN", ReviewType.FINAL_CLINICAL_REVIEW, 0L, null));

        assertThrows(ReviewTaskStateException.class, () -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 0L, 3L,
                ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CONFIRMED)));
        verifyNoDecisionPersisted();
    }

    @Test
    void workflowNoLongerWaitingForReviewRejectsTheDecision() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, DOCTOR_ID));
        stubWorkflow(workflow("RUNNING", 4L));

        assertThrows(ReviewTaskStateException.class, () -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L, 4L,
                ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CONFIRMED)));
        verifyNoDecisionPersisted();
    }

    @Test
    void staleWorkflowVersionIsRejectedBeforeAnyWrite() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, DOCTOR_ID));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 6L));

        assertThrows(ReviewTaskConflictException.class, () -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L, 5L,
                ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CONFIRMED)));
        verifyNoDecisionPersisted();
    }

    @Test
    void lostTaskCompareAndSetStopsBeforeTheWorkflowTransition() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, DOCTOR_ID));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 5L));
        stubEnvelope("VALID_PREDICTION");
        when(taskRepository.submitDecisionIfVersionMatches(anyString(), anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(0);

        assertThrows(ReviewTaskConflictException.class, () -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L, 5L,
                ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CONFIRMED)));
        verify(workflowRepository, never()).updateStateIfVersionMatches(anyString(), anyLong(), anyString(),
                anyString(), anyString(), any(), any(), any(), any());
        verify(jobCreationService, never()).createIfAbsent(any());
    }

    @Test
    void duplicateResumeJobIsSurfacedAsAConflict() {
        stubTask(task("CLAIMED", ReviewType.FINAL_CLINICAL_REVIEW, 1L, DOCTOR_ID));
        stubWorkflow(workflow("WAITING_HUMAN_REVIEW", 5L));
        stubEnvelope("VALID_PREDICTION");
        stubAcceptingCas(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME);
        when(jobCreationService.createIfAbsent(any()))
                .thenReturn(new JobCreationResult(JobCreationResult.Status.ALREADY_EXISTS, "job-x"));

        assertThrows(ReviewTaskConflictException.class, () -> service.submit(new SubmitReviewDecisionCommand(TASK_ID,
                reviewer(DOCTOR_ID, ReviewType.FINAL_CLINICAL_REVIEW), 1L, 5L,
                ValidPredictionReviewDecision.CONFIRM_AI_ASSESSMENT, ReviewReasonCode.AI_ASSESSMENT_CONFIRMED)));
        verify(eventRepository, never()).append(any());
    }

    // ---- cancel ----

    @Test
    void activeTaskCanBeCancelledUnderVersionCas() {
        stubTask(task("OPEN", ReviewType.IMAGE_QUALITY_GATE, 0L, null));
        when(taskRepository.cancelIfVersionMatches(TASK_ID, 0L)).thenReturn(1);

        assertDoesNotThrow(() -> service.cancel(TASK_ID, 0L));
        verify(taskRepository).cancelIfVersionMatches(TASK_ID, 0L);
    }

    @Test
    void submittedTaskCanNoLongerBeCancelled() {
        stubTask(task("SUBMITTED", ReviewType.IMAGE_QUALITY_GATE, 2L, DOCTOR_ID));

        assertThrows(ReviewTaskStateException.class, () -> service.cancel(TASK_ID, 2L));
        verify(taskRepository, never()).cancelIfVersionMatches(anyString(), anyLong());
    }

    // ---- helpers ----

    private void stubTask(HumanReviewTaskEntity task) {
        when(taskRepository.findById(TASK_ID)).thenReturn(Optional.of(task));
    }

    private void stubWorkflow(DiagnosisWorkflowEntity workflow) {
        when(workflowRepository.findByWorkflowId(WORKFLOW_ID)).thenReturn(Optional.of(workflow));
    }

    private void stubEnvelope(String outcomeType) {
        InferenceEnvelopeEntity envelope = new InferenceEnvelopeEntity();
        envelope.setInferenceOutcomeType(outcomeType);
        when(envelopeRepository.findByWorkflowIdAndEpoch(WORKFLOW_ID, 1L)).thenReturn(Optional.of(envelope));
    }

    private void stubAcceptingCas(SegmentCode resumeSegment) {
        when(taskRepository.submitDecisionIfVersionMatches(anyString(), anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(1);
        when(workflowRepository.updateStateIfVersionMatches(eq(WORKFLOW_ID), anyLong(), eq("WAITING_HUMAN_REVIEW"),
                eq("RUNNING"), eq(resumeSegment.name()), any(), any(), any(), any())).thenReturn(1);
    }

    private void verifyNoDecisionPersisted() {
        verify(taskRepository, never()).submitDecisionIfVersionMatches(anyString(), anyLong(), anyLong(),
                anyString(), anyString());
        verify(jobCreationService, never()).createIfAbsent(any());
        verify(eventRepository, never()).append(any());
    }

    private static HumanReviewTaskEntity task(String status, ReviewType type, long taskVersion, Long assignedDoctorId) {
        HumanReviewTaskEntity task = new HumanReviewTaskEntity();
        task.setReviewTaskId(TASK_ID);
        task.setWorkflowId(WORKFLOW_ID);
        task.setReviewType(type.name());
        task.setReviewRound(1);
        task.setStatus(status);
        task.setTaskVersion(taskVersion);
        task.setAssignedDoctorId(assignedDoctorId);
        task.setGraphThreadId("thread-1");
        task.setGraphCheckpointId("checkpoint-1");
        return task;
    }

    private static DiagnosisWorkflowEntity workflow(String status, long workflowVersion) {
        DiagnosisWorkflowEntity workflow = new DiagnosisWorkflowEntity();
        workflow.setWorkflowId(WORKFLOW_ID);
        workflow.setOwnerUserId(PATIENT_ID);
        workflow.setStatus(status);
        workflow.setWorkflowVersion(workflowVersion);
        workflow.setInferenceEpoch(1L);
        workflow.setExplanationPublicationStatus("PENDING");
        workflow.setPredictionExposureStatus("HIDDEN");
        return workflow;
    }

    private static ReviewerPrincipal reviewer(long userId, ReviewType... types) {
        return new ReviewerPrincipal(userId, Set.of(types));
    }
}

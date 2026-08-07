package com.csust.eyediagnosis.workflow.api;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.workflow.CreateWorkflowRequest;
import com.csust.eyediagnosis.model.dto.workflow.SymptomsDTO;
import com.csust.eyediagnosis.model.dto.workflow.WorkflowCreateResult;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionDescriptor;
import com.csust.eyediagnosis.workflow.graph.registry.GraphDefinitionRegistry;
import com.csust.eyediagnosis.workflow.job.JobCreationResult;
import com.csust.eyediagnosis.workflow.job.NewWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobCreationService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowStateMutator;
import com.csust.eyediagnosis.workflow.policy.WorkflowLifecycleGuard;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * PR-10: unit coverage for the API-side command orchestration. All PR-01..PR-09 collaborators are
 * mocked — this suite verifies only the gateway-owned wiring: idempotency, atomic-create ordering,
 * CREATED→QUEUED CAS, WORKFLOW_CREATED event payload, and the cancel guard rails.
 */
class WorkflowCommandServiceTest {

    @Mock
    private DiagnosisWorkflowRepository workflowRepository;
    @Mock
    private WorkflowEventRepository eventRepository;
    @Mock
    private WorkflowJobCreationService jobCreationService;
    @Mock
    private GraphDefinitionRegistry graphDefinitionRegistry;

    private WorkflowCommandService commandService;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        WorkflowStateMutator stateMutator = new WorkflowStateMutator(workflowRepository, eventRepository);
        commandService = new WorkflowCommandService(workflowRepository, jobCreationService,
                graphDefinitionRegistry, new WorkflowLifecycleGuard(), new ObjectMapper(), stateMutator, null);
    }

    private User user(long id) {
        User u = new User();
        u.setId(id);
        u.setUserRole("user");
        return u;
    }

    private CreateWorkflowRequest request() {
        CreateWorkflowRequest r = new CreateWorkflowRequest();
        r.setImageId("img-1");
        r.setQuestion("这是什么病？");
        SymptomsDTO s = new SymptomsDTO();
        s.setSuddenVisionLoss(true);
        r.setSymptoms(s);
        return r;
    }

    private void stubHappyPath() {
        when(workflowRepository.findByOwnerAndIdempotencyKey(1L, "img-1")).thenReturn(Optional.empty());
        when(graphDefinitionRegistry.listSupported())
                .thenReturn(List.of(new GraphDefinitionDescriptor("v1", "hash1", "a1")));
        DiagnosisWorkflowEntity created = new DiagnosisWorkflowEntity();
        created.setExplanationPublicationStatus("NONE");
        created.setPredictionExposureStatus("NOT_AVAILABLE");
        when(workflowRepository.findByWorkflowId(anyString())).thenReturn(Optional.of(created));
        when(jobCreationService.createIfAbsent(any(NewWorkflowJob.class)))
                .thenReturn(new JobCreationResult(JobCreationResult.Status.CREATED, "job-1"));
        when(workflowRepository.updateStateIfVersionMatches(anyString(), eq(0L),
                eq(WorkflowStatus.CREATED.name()), eq(WorkflowStatus.QUEUED.name()),
                anyString(), anyString(), anyString(), isNull(), isNull())).thenReturn(1);
    }

    @Test
    void createInsertsWorkflowJobAndEventThenReturnsQueued() {
        stubHappyPath();

        WorkflowCreateResult result = commandService.createWorkflow(request(), user(1L));

        assertNotNull(result.getWorkflowId());
        assertEquals(WorkflowStatus.QUEUED.name(), result.getStatus());

        ArgumentCaptor<DiagnosisWorkflowEntity> workflowCaptor =
                ArgumentCaptor.forClass(DiagnosisWorkflowEntity.class);
        verify(workflowRepository).insert(workflowCaptor.capture());
        assertEquals("img-1", workflowCaptor.getValue().getCreationIdempotencyKey());
        assertEquals(WorkflowStatus.CREATED.name(), workflowCaptor.getValue().getStatus());
        assertEquals(SegmentCode.INTAKE_INFERENCE_QUALITY.name(),
                workflowCaptor.getValue().getCurrentSegmentCode());

        ArgumentCaptor<NewWorkflowJob> jobCaptor = ArgumentCaptor.forClass(NewWorkflowJob.class);
        verify(jobCreationService).createIfAbsent(jobCaptor.capture());
        assertEquals(SegmentCode.INTAKE_INFERENCE_QUALITY, jobCaptor.getValue().segmentCode());
        assertEquals(WorkflowJobType.START_SEGMENT, jobCaptor.getValue().jobType());

        ArgumentCaptor<DiagnosisWorkflowEventEntity> eventCaptor =
                ArgumentCaptor.forClass(DiagnosisWorkflowEventEntity.class);
        verify(eventRepository).append(eventCaptor.capture());
        assertEquals("WORKFLOW_CREATED", eventCaptor.getValue().getEventType());
        assertTrue(eventCaptor.getValue().getPayloadSnapshot().contains("\"imageId\":\"img-1\""));
        assertTrue(eventCaptor.getValue().getPayloadSnapshot().contains("\"suddenVisionLoss\":true"));
    }

    @Test
    void duplicateImageIdForSameOwnerIsRejected() {
        DiagnosisWorkflowEntity existing = new DiagnosisWorkflowEntity();
        existing.setWorkflowId("wf_existing");
        when(workflowRepository.findByOwnerAndIdempotencyKey(1L, "img-1"))
                .thenReturn(Optional.of(existing));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> commandService.createWorkflow(request(), user(1L)));
        assertEquals(ErrorCode.OPERATION_ERROR.getCode(), ex.getCode());
        verify(workflowRepository, never()).insert(any());
        verify(jobCreationService, never()).createIfAbsent(any());
    }

    @Test
    void createFailsWhenInitialJobConflicts() {
        when(workflowRepository.findByOwnerAndIdempotencyKey(1L, "img-1")).thenReturn(Optional.empty());
        when(graphDefinitionRegistry.listSupported())
                .thenReturn(List.of(new GraphDefinitionDescriptor("v1", "hash1", "a1")));
        when(jobCreationService.createIfAbsent(any(NewWorkflowJob.class)))
                .thenReturn(new JobCreationResult(JobCreationResult.Status.ALREADY_EXISTS, "job-x"));

        assertThrows(BusinessException.class, () -> commandService.createWorkflow(request(), user(1L)));
        verify(eventRepository, never()).append(any());
    }

    @Test
    void createFailsWhenNoGraphDefinitionConfigured() {
        when(workflowRepository.findByOwnerAndIdempotencyKey(1L, "img-1")).thenReturn(Optional.empty());
        when(graphDefinitionRegistry.listSupported()).thenReturn(List.of());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> commandService.createWorkflow(request(), user(1L)));
        assertEquals(ErrorCode.SYSTEM_ERROR.getCode(), ex.getCode());
    }

    @Test
    void cancelRejectsTerminalStatus() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> commandService.cancelWorkflow("wf_1", 4L, "COMPLETED"));
        assertEquals(ErrorCode.FORBIDDEN_ERROR.getCode(), ex.getCode());
        verify(workflowRepository, never()).updateStateIfVersionMatches(anyString(), anyLong(),
                anyString(), anyString(), any(), any(), any(), any(), any());
    }

    @Test
    void cancelTransitionsRunningToCancelledViaCas() {
        DiagnosisWorkflowEntity latest = new DiagnosisWorkflowEntity();
        latest.setWorkflowId("wf_1");
        latest.setCurrentSegmentCode(SegmentCode.INTAKE_INFERENCE_QUALITY.name());
        latest.setExplanationPublicationStatus("NONE");
        latest.setPredictionExposureStatus("NOT_AVAILABLE");
        when(workflowRepository.findByWorkflowId("wf_1")).thenReturn(Optional.of(latest));
        when(workflowRepository.updateStateIfVersionMatches("wf_1", 4L,
                WorkflowStatus.RUNNING.name(), WorkflowStatus.CANCELLED.name(),
                SegmentCode.INTAKE_INFERENCE_QUALITY.name(), "NONE", "NOT_AVAILABLE", null, null))
                .thenReturn(1);

        commandService.cancelWorkflow("wf_1", 4L, "RUNNING");

        verify(workflowRepository).updateStateIfVersionMatches("wf_1", 4L,
                WorkflowStatus.RUNNING.name(), WorkflowStatus.CANCELLED.name(),
                SegmentCode.INTAKE_INFERENCE_QUALITY.name(), "NONE", "NOT_AVAILABLE", null, null);
    }

    @Test
    void cancelCasConflictSurfacesOperationError() {
        DiagnosisWorkflowEntity latest = new DiagnosisWorkflowEntity();
        latest.setWorkflowId("wf_1");
        latest.setCurrentSegmentCode(SegmentCode.INTAKE_INFERENCE_QUALITY.name());
        latest.setExplanationPublicationStatus("NONE");
        latest.setPredictionExposureStatus("NOT_AVAILABLE");
        when(workflowRepository.findByWorkflowId("wf_1")).thenReturn(Optional.of(latest));
        when(workflowRepository.updateStateIfVersionMatches(anyString(), anyLong(), anyString(),
                anyString(), any(), any(), any(), any(), any())).thenReturn(0);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> commandService.cancelWorkflow("wf_1", 4L, "QUEUED"));
        assertEquals(ErrorCode.OPERATION_ERROR.getCode(), ex.getCode());
    }
}

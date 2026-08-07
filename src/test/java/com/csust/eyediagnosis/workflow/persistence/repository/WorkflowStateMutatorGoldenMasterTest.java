package com.csust.eyediagnosis.workflow.persistence.repository;

import com.csust.eyediagnosis.workflow.contract.CreateWorkflowCommand;
import com.csust.eyediagnosis.workflow.contract.RecordEventCommand;
import com.csust.eyediagnosis.workflow.contract.WorkflowEventBuilder;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Golden-master for the C1 persistence façade. It pins the exact commit order and the state-advance
 * sequence (insert CREATED row &#8594; append WORKFLOW_CREATED event &#8594; CREATED&#8594;QUEUED CAS) so any
 * regression in the workflow lifecycle ordering is caught. No production code changes are required
 * to satisfy this test.
 */
class WorkflowStateMutatorGoldenMasterTest {

    @Test
    void createThenRecordThenTransitionPinsCommitOrderAndStateSequence() {
        DiagnosisWorkflowRepository workflows = mock(DiagnosisWorkflowRepository.class);
        WorkflowEventRepository events = mock(WorkflowEventRepository.class);
        WorkflowStateMutator mutator = new WorkflowStateMutator(workflows, events);

        DiagnosisWorkflowEntity latest = new DiagnosisWorkflowEntity();
        latest.setWorkflowId("wf_1");
        latest.setExplanationPublicationStatus("NONE");
        latest.setPredictionExposureStatus("NOT_AVAILABLE");
        when(workflows.findByWorkflowId("wf_1")).thenReturn(Optional.of(latest));
        when(workflows.insert(any(DiagnosisWorkflowEntity.class))).thenReturn(1);
        when(workflows.updateStateIfVersionMatches(anyString(), anyLong(), anyString(), anyString(),
                anyString(), anyString(), anyString(), isNull(), isNull())).thenReturn(1);

        // 1) persist the initial CREATED row
        CreateWorkflowCommand create = new CreateWorkflowCommand("wf_1", 1L, "img-1",
                "v1", "h1", "a1", "question");
        mutator.createWorkflow(create);

        // 2) append the WORKFLOW_CREATED event
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("imageId", "img-1");
        payload.put("question", "question");
        RecordEventCommand created = WorkflowEventBuilder.createdEvent("wf_1", "1",
                SegmentCode.INTAKE_INFERENCE_QUALITY.name(), payload, new ObjectMapper());
        mutator.recordEvent(created);

        // 3) advance CREATED -> QUEUED
        int updated = mutator.transitionStatus("wf_1", 0L, WorkflowStatus.CREATED,
                WorkflowStatus.QUEUED, SegmentCode.INTAKE_INFERENCE_QUALITY.name());

        assertEquals(1, updated);

        // pin the exact commit order: insert -> append -> transition
        var ordered = inOrder(workflows, events);
        ordered.verify(workflows).insert(any(DiagnosisWorkflowEntity.class));
        ordered.verify(events).append(any(DiagnosisWorkflowEventEntity.class));
        ordered.verify(workflows).updateStateIfVersionMatches(eq("wf_1"), eq(0L),
                eq(WorkflowStatus.CREATED.name()), eq(WorkflowStatus.QUEUED.name()),
                eq(SegmentCode.INTAKE_INFERENCE_QUALITY.name()), eq("NONE"), eq("NOT_AVAILABLE"),
                isNull(), isNull());

        // pin the created-event shape
        var eventCaptor = org.mockito.ArgumentCaptor.forClass(DiagnosisWorkflowEventEntity.class);
        verify(events).append(eventCaptor.capture());
        DiagnosisWorkflowEventEntity event = eventCaptor.getValue();
        assertEquals("WORKFLOW_CREATED", event.getEventType());
        assertEquals(1L, event.getEventSequence());
        assertEquals(0L, event.getWorkflowVersion());

        // pin the inserted entity is CREATED at version 0
        var workflowCaptor = org.mockito.ArgumentCaptor.forClass(DiagnosisWorkflowEntity.class);
        verify(workflows).insert(workflowCaptor.capture());
        assertEquals(WorkflowStatus.CREATED.name(), workflowCaptor.getValue().getStatus());
        assertEquals(0L, workflowCaptor.getValue().getWorkflowVersion());
    }
}

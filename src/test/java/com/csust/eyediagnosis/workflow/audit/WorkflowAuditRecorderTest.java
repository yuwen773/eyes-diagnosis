package com.csust.eyediagnosis.workflow.audit;

import com.csust.eyediagnosis.workflow.persistence.mapper.WorkflowAuditEventMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.MDC;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/** PR-12.2 append-only audit trail tests. */
class WorkflowAuditRecorderTest {

    @AfterEach
    void cleanupMdc() {
        MDC.clear();
    }

    @Test
    void auditVocabularyContainsExactlySixRequiredEvents() {
        Set<String> names = Arrays.stream(AuditEventType.values())
                .map(Enum::name).collect(Collectors.toSet());
        assertEquals(Set.of("AI_INFERENCE_COMPLETED", "EVIDENCE_VALIDATED", "EXPLANATION_PUBLISHED",
                "REVIEW_ASSIGNED", "REVIEW_COMPLETED", "RESULT_EXPOSED"), names);
    }

    @Test
    void draftRejectsMissingMandatoryFields() {
        assertThrows(IllegalArgumentException.class, () -> new WorkflowAuditEventDraft(
                null, AuditEventType.RESULT_EXPOSED, "SYSTEM", null, null, null));
        assertThrows(IllegalArgumentException.class, () -> new WorkflowAuditEventDraft(
                "wf-1", null, "SYSTEM", null, null, null));
        assertThrows(IllegalArgumentException.class, () -> new WorkflowAuditEventDraft(
                "wf-1", AuditEventType.RESULT_EXPOSED, " ", null, null, null));
    }

    @Test
    void appendPersistsAllDraftFieldsAndGeneratesId() {
        WorkflowAuditEventMapper mapper = mock(WorkflowAuditEventMapper.class);
        MybatisWorkflowAuditRecorder recorder = new MybatisWorkflowAuditRecorder(mapper);

        recorder.append(new WorkflowAuditEventDraft("wf-42", AuditEventType.REVIEW_COMPLETED,
                "DOCTOR", "9001", "FINAL_CLINICAL_REVIEW_RESUME", "{\"decision\":\"APPROVE\"}"));

        ArgumentCaptor<WorkflowAuditEventEntity> captor = ArgumentCaptor.forClass(WorkflowAuditEventEntity.class);
        verify(mapper).insert(captor.capture());
        WorkflowAuditEventEntity saved = captor.getValue();
        assertNotNull(saved.getAuditEventId());
        assertEquals("wf-42", saved.getWorkflowId());
        assertEquals("REVIEW_COMPLETED", saved.getEventType());
        assertEquals("DOCTOR", saved.getActorType());
        assertEquals("9001", saved.getActorId());
        assertEquals("FINAL_CLINICAL_REVIEW_RESUME", saved.getSegmentCode());
        assertEquals("{\"decision\":\"APPROVE\"}", saved.getPayloadSnapshot());
        assertNotNull(saved.getOccurredAt());
    }

    @Test
    void appendPropagatesTraceIdFromMdc() {
        WorkflowAuditEventMapper mapper = mock(WorkflowAuditEventMapper.class);
        MybatisWorkflowAuditRecorder recorder = new MybatisWorkflowAuditRecorder(mapper);

        MDC.put("traceId", "trace-abc-123");
        recorder.append(WorkflowAuditEventDraft.system("wf-1", AuditEventType.AI_INFERENCE_COMPLETED,
                "INTAKE_INFERENCE_QUALITY", null));

        ArgumentCaptor<WorkflowAuditEventEntity> captor = ArgumentCaptor.forClass(WorkflowAuditEventEntity.class);
        verify(mapper).insert(captor.capture());
        assertEquals("trace-abc-123", captor.getValue().getTraceId());
    }

    @Test
    void systemFactoryProducesSystemActorWithoutActorId() {
        WorkflowAuditEventDraft draft = WorkflowAuditEventDraft.system(
                "wf-1", AuditEventType.EVIDENCE_VALIDATED, "EVIDENCE_RETRIEVAL_VALIDATION", "{}");
        assertEquals("SYSTEM", draft.actorType());
        assertNull(draft.actorId());
    }

    @Test
    void recorderApiIsAppendOnlyNoUpdateOrDelete() {
        List<String> methodNames = Arrays.stream(WorkflowAuditRecorder.class.getMethods())
                .map(Method::getName).toList();
        assertEquals(List.of("append", "findByWorkflowId"),
                methodNames.stream().sorted().toList());
        assertTrue(methodNames.stream().noneMatch(n ->
                n.toLowerCase().contains("update") || n.toLowerCase().contains("delete")
                        || n.toLowerCase().contains("remove")));
    }

    @Test
    void findByWorkflowIdDelegatesToMapper() {
        WorkflowAuditEventMapper mapper = mock(WorkflowAuditEventMapper.class);
        MybatisWorkflowAuditRecorder recorder = new MybatisWorkflowAuditRecorder(mapper);
        recorder.findByWorkflowId("wf-7");
        verify(mapper).selectList(any());
    }
}

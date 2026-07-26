package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiency;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiencyReasonCode;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.ExplanationSnapshotRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.NodeExecutionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ExplanationInvocationCoordinatorTest {
    @Test void reservesOnceAndFailsClosedWhenReservationAlreadyExists() {
        ExplanationSnapshotRepository snapshots = mock(ExplanationSnapshotRepository.class);
        NodeExecutionRepository executions = mock(NodeExecutionRepository.class);
        DiagnosisCitationSnapshot citation = new DiagnosisCitationSnapshot("wf", 1, "source", "r1", "chunk", "title", "quoted", "digest", Set.of("GLAUCOMA"), Set.of("DISEASE"), .9, "retrieval", "catalog");
        ExplanationDraftRequest request = new ExplanationDraftRequest("wf", 1, 1, new PatientPredictionProjection("GLAUCOMA", .8), List.of(citation), new EvidenceSufficiency(1, Set.of("GLAUCOMA"), Set.of("DISEASE"), true, EvidenceSufficiencyReasonCode.SUFFICIENT), "policy", "prompt");
        AtomicInteger calls = new AtomicInteger();
        ExplanationModelClient model = ignored -> { calls.incrementAndGet(); return new ExplanationModelResult(new ExplanationDraft("summary", List.of(), "notice", "model", "prompt", "policy")); };
        when(snapshots.findByWorkflowIdAndRevision("wf", 1)).thenReturn(Optional.empty());
        when(executions.findByIdempotencyKey(any())).thenReturn(Optional.empty()); when(executions.insertIfAbsent(any())).thenReturn(1);
        when(snapshots.insert(any())).thenReturn(1); when(executions.complete(any())).thenReturn(1);
        ExplanationInvocationCoordinator coordinator = new ExplanationInvocationCoordinator(snapshots, executions, model, new ObjectMapper());
        assertEquals(ExplanationGenerationOutcome.Status.GENERATED, coordinator.getOrGenerate(request, "graph", "action").status());
        assertEquals(1, calls.get());
        WorkflowNodeExecutionEntity reservation = new WorkflowNodeExecutionEntity();
        when(executions.findByIdempotencyKey(any())).thenReturn(Optional.of(reservation));
        assertEquals(ExplanationGenerationOutcome.Status.WITHHELD, coordinator.getOrGenerate(request, "graph", "action").status());
        assertEquals(1, calls.get());
    }
}

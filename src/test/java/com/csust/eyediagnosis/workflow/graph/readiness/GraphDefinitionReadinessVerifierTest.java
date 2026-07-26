package com.csust.eyediagnosis.workflow.graph.readiness;

import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.definition.Sha256GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.definition.StandardFundusDiagnosisGraphV1;
import com.csust.eyediagnosis.workflow.graph.exception.GraphRuntimeNotReadyException;
import com.csust.eyediagnosis.workflow.graph.registry.InMemoryGraphDefinitionRegistry;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.ActiveWorkflowGraphBinding;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GraphDefinitionReadinessVerifierTest {
    private final GraphDefinitionHasher hasher = new Sha256GraphDefinitionHasher();
    private final StandardFundusDiagnosisGraphV1 v1 = new StandardFundusDiagnosisGraphV1(hasher);

    @Test
    void acceptsEmptyAndExactlySupportedNonTerminalBindings() {
        assertEquals(0, verifier(List.of()).verifyNonTerminalWorkflows().checkedWorkflowCount());
        var report = verifier(List.of(binding("waiting", WorkflowStatus.WAITING_HUMAN_REVIEW, v1.definitionVersion(), v1.definitionHash(), v1.actionVersion()))).verifyNonTerminalWorkflows();
        assertEquals(1, report.checkedWorkflowCount());
        assertEquals(java.util.Set.of(v1.definitionVersion()), report.requiredDefinitionVersions());
    }

    @Test
    void aggregatesUnsupportedHashAndActionFailuresWithoutPatientData() {
        var failure = assertThrows(GraphRuntimeNotReadyException.class, () -> verifier(List.of(
                binding("version", WorkflowStatus.RUNNING, "missing", v1.definitionHash(), v1.actionVersion()),
                binding("hash", WorkflowStatus.CREATED, v1.definitionVersion(), "wrong", v1.actionVersion()),
                binding("action", WorkflowStatus.QUEUED, v1.definitionVersion(), v1.definitionHash(), "wrong")))
                .verifyNonTerminalWorkflows());
        assertEquals(1, failure.unsupportedVersionCount());
        assertEquals(1, failure.hashMismatchCount());
        assertEquals(1, failure.actionVersionMismatchCount());
        assertEquals(List.of("action", "hash", "version"), failure.affectedWorkflowIds());
    }

    private DefaultGraphDefinitionReadinessVerifier verifier(List<ActiveWorkflowGraphBinding> bindings) {
        return new DefaultGraphDefinitionReadinessVerifier(new StubRepository(bindings), new InMemoryGraphDefinitionRegistry(List.of(v1), hasher));
    }

    private static ActiveWorkflowGraphBinding binding(String id, WorkflowStatus status, String version, String hash, String action) {
        return new ActiveWorkflowGraphBinding(id, status, version, hash, action);
    }

    private record StubRepository(List<ActiveWorkflowGraphBinding> bindings) implements DiagnosisWorkflowRepository {
        @Override public Optional<DiagnosisWorkflowEntity> findByWorkflowId(String workflowId) { throw new UnsupportedOperationException(); }
        @Override public Optional<DiagnosisWorkflowEntity> findByOwnerAndIdempotencyKey(Long ownerUserId, String idempotencyKey) { throw new UnsupportedOperationException(); }
        @Override public List<ActiveWorkflowGraphBinding> findNonTerminalGraphBindings() { return bindings; }
        @Override public int insert(DiagnosisWorkflowEntity entity) { throw new UnsupportedOperationException(); }
        @Override public int updateStateIfVersionMatches(String workflowId, long expectedVersion, String expectedStatus, String targetStatus, String currentSegmentCode, String publicationStatus, String exposureStatus, String stopReasonCode, String limitationReasonCode) { throw new UnsupportedOperationException(); }
    }
}

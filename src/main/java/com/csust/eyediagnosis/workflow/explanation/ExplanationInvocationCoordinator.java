package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.persistence.entity.ExplanationSnapshotEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.ExplanationSnapshotRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.NodeExecutionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DuplicateKeyException;
import java.time.LocalDateTime;
import java.util.UUID;

/** Reserves a revision before the model call; any uncertain existing reservation fails closed. */
public final class ExplanationInvocationCoordinator {
    private static final String NODE_CODE = "EXPLANATION_DRAFT";
    private static final int RESULT_POLL_ATTEMPTS = 25;
    private static final long RESULT_POLL_MILLIS = 20L;
    private final ExplanationSnapshotRepository snapshots;
    private final NodeExecutionRepository executions;
    private final ExplanationModelClient model;
    private final ObjectMapper mapper;

    public ExplanationInvocationCoordinator(ExplanationSnapshotRepository snapshots, NodeExecutionRepository executions,
                                            ExplanationModelClient model, ObjectMapper mapper) {
        this.snapshots = snapshots; this.executions = executions; this.model = model; this.mapper = mapper;
    }
    public ExplanationGenerationOutcome getOrGenerate(ExplanationDraftRequest request, String graphDefinitionVersion, String actionVersion) {
        return snapshots.findByWorkflowIdAndRevision(request.workflowId(), request.explanationRevision())
                .map(snapshot -> new ExplanationGenerationOutcome(ExplanationGenerationOutcome.Status.EXISTING, snapshot, null))
                .orElseGet(() -> generateAfterReservation(request, graphDefinitionVersion, actionVersion));
    }
    private ExplanationGenerationOutcome generateAfterReservation(ExplanationDraftRequest request, String graphDefinitionVersion, String actionVersion) {
        String key = request.workflowId() + "|" + graphDefinitionVersion + "|" + actionVersion + "|" + NODE_CODE + "|" + request.explanationRevision();
        if (executions.findByIdempotencyKey(key).isPresent()) return awaitAcceptedSnapshot(request);
        WorkflowNodeExecutionEntity reservation = reservation(request, key);
        try { if (executions.insertIfAbsent(reservation) != 1) return awaitAcceptedSnapshot(request); }
        catch (DuplicateKeyException exception) { return awaitAcceptedSnapshot(request); }
        try {
            ExplanationDraft draft = model.generate(new ExplanationModelRequest(request.prediction(), request.citations(), request.explanationPolicyVersion(), request.promptVersion())).draft();
            ExplanationSnapshotEntity snapshot = ExplanationSnapshotFactory.entity(request.workflowId(), request.explanationRevision(), draft, null, request.citations(), mapper);
            if (snapshots.insert(snapshot) != 1) throw new IllegalStateException("snapshot was not inserted");
            reservation.setStatus("COMPLETED"); reservation.setOutputDigest(ExplanationSnapshotFactory.digest(snapshot.getContentSnapshot()));
            reservation.setResultReference(snapshot.getExplanationSnapshotId()); reservation.setCompletedAt(LocalDateTime.now()); reservation.setUpdatedAt(LocalDateTime.now());
            if (executions.complete(reservation) != 1) throw new IllegalStateException("reservation was not completed");
            return new ExplanationGenerationOutcome(ExplanationGenerationOutcome.Status.GENERATED, snapshot, null);
        } catch (RuntimeException exception) { return withheld(); }
    }
    private static WorkflowNodeExecutionEntity reservation(ExplanationDraftRequest request, String key) {
        WorkflowNodeExecutionEntity entity = new WorkflowNodeExecutionEntity(); entity.setNodeExecutionId(UUID.randomUUID().toString());
        entity.setWorkflowId(request.workflowId()); entity.setExecutionEpoch(request.inferenceEpoch()); entity.setSegmentCode("FINAL_RISK_EXPLANATION");
        entity.setNodeCode(NODE_CODE); entity.setIdempotencyKey(key); entity.setStatus("RESERVED"); entity.setStartedAt(LocalDateTime.now()); return entity;
    }
    private ExplanationGenerationOutcome awaitAcceptedSnapshot(ExplanationDraftRequest request) {
        for (int attempt = 0; attempt < RESULT_POLL_ATTEMPTS; attempt++) {
            var snapshot = snapshots.findByWorkflowIdAndRevision(request.workflowId(), request.explanationRevision());
            if (snapshot.isPresent()) return new ExplanationGenerationOutcome(ExplanationGenerationOutcome.Status.EXISTING, snapshot.get(), null);
            try { Thread.sleep(RESULT_POLL_MILLIS); }
            catch (InterruptedException exception) { Thread.currentThread().interrupt(); break; }
        }
        return withheld();
    }
    private static ExplanationGenerationOutcome withheld() { return new ExplanationGenerationOutcome(ExplanationGenerationOutcome.Status.WITHHELD, null, ExplanationGenerationException.Code.EXPLANATION_GENERATION_OUTCOME_UNKNOWN.name()); }
}

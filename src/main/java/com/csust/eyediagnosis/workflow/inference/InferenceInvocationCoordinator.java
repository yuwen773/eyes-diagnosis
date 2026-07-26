package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import com.csust.eyediagnosis.workflow.graph.runtime.NodeExecutionCompletion;
import com.csust.eyediagnosis.workflow.persistence.repository.InferenceEnvelopeRepository;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;

/** Reserves before invoking and fails closed after any uncertain invocation window. */
@Service
public final class InferenceInvocationCoordinator {
    private final InferenceEnvelopeRepository envelopeRepository;
    private final InferenceInvocationReservationService reservationService;
    private final InferenceIdempotencyKeyFactory keyFactory;
    private final DiagnoseModelClient modelClient;
    private final WorkflowInferenceProperties properties;
    public InferenceInvocationCoordinator(InferenceEnvelopeRepository envelopeRepository, InferenceInvocationReservationService reservationService, InferenceIdempotencyKeyFactory keyFactory, DiagnoseModelClient modelClient, WorkflowInferenceProperties properties) { this.envelopeRepository = envelopeRepository; this.reservationService = reservationService; this.keyFactory = keyFactory; this.modelClient = modelClient; this.properties = properties; }
    public InferenceInvocationResult getOrInvoke(InferenceInvocationRequest request) {
        var existing = envelopeRepository.findByWorkflowIdAndEpoch(request.input().workflowId(), request.inferenceEpoch());
        if (existing.isPresent()) return new InferenceInvocationResult(InferenceEnvelopePersistenceMapper.fromEntity(existing.get()), null);
        String key = keyFactory.create(request.input().workflowId(), request.graphDefinitionVersion(), request.actionVersion(), request.inferenceEpoch());
        String nodeId = reservationService.reserve(request, key);
        if (nodeId == null) return new InferenceInvocationResult(InferenceEnvelopeFactory.technical(request.input(), request.inferenceEpoch(), TechnicalFailureCode.RPC_OUTCOME_UNKNOWN), null);
        InferenceEnvelope envelope;
        try { envelope = InferenceEnvelopeFactory.fromResult(request.input(), request.inferenceEpoch(), modelClient.diagnose(new DiagnoseModelRequest(request.input().workflowId(), request.inferenceEpoch(), request.input().imageBytes(), request.input().inputDigest(), request.input().mediaType())), properties); }
        catch (DiagnoseModelException exception) { envelope = InferenceEnvelopeFactory.technical(request.input(), request.inferenceEpoch(), exception.failureCode()); }
        return new InferenceInvocationResult(envelope, new NodeExecutionCompletion(nodeId, sha256(envelope.toString()), "pending-envelope"));
    }
    private static String sha256(String value) { try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8))); } catch (Exception exception) { throw new IllegalStateException(exception); } }
}

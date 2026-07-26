package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.persistence.entity.InferenceEnvelopeEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.InferenceEnvelopeRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.NodeExecutionRepository;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/** Persists only accepted inference state; RPC invocation and graph routing stay outside this writer. */
@Component
public final class InferenceEnvelopeDeltaWriter implements SegmentBusinessDeltaWriter<InferenceEnvelopeDelta> {
    private final InferenceEnvelopeRepository envelopeRepository;
    private final NodeExecutionRepository nodeExecutionRepository;
    private final DiagnosisWorkflowRepository workflowRepository;
    public InferenceEnvelopeDeltaWriter(InferenceEnvelopeRepository envelopeRepository, NodeExecutionRepository nodeExecutionRepository, DiagnosisWorkflowRepository workflowRepository) { this.envelopeRepository = envelopeRepository; this.nodeExecutionRepository = nodeExecutionRepository; this.workflowRepository = workflowRepository; }
    @Override public Class<InferenceEnvelopeDelta> supportedType() { return InferenceEnvelopeDelta.class; }
    @Override public void write(InferenceEnvelopeDelta delta) {
        String envelopeId = UUID.randomUUID().toString();
        if (envelopeRepository.insert(toEntity(envelopeId, delta.envelope())) != 1) throw new IllegalStateException("inference envelope was not persisted");
        WorkflowNodeExecutionEntity node = new WorkflowNodeExecutionEntity(); node.setNodeExecutionId(delta.nodeExecution().nodeExecutionId()); node.setStatus("COMPLETED"); node.setOutputDigest(delta.nodeExecution().outputDigest()); node.setResultReference(envelopeId); node.setCompletedAt(LocalDateTime.now()); node.setUpdatedAt(LocalDateTime.now());
        if (nodeExecutionRepository.complete(node) != 1) throw new IllegalStateException("inference invocation was not completed");
        if (workflowRepository.attachInferenceEnvelopeIfVersionMatches(delta.envelope().workflowId(), delta.expectedWorkflowVersion(), envelopeId) != 1) throw new IllegalStateException("workflow inference envelope CAS failed");
    }
    private static InferenceEnvelopeEntity toEntity(String id, InferenceEnvelope e) {
        InferenceEnvelopeEntity x = new InferenceEnvelopeEntity(); x.setInferenceEnvelopeId(id); x.setWorkflowId(e.workflowId()); x.setInferenceEpoch(e.inferenceEpoch()); x.setImageObjectReference(e.imageObjectReference()); x.setInputDigest(e.inputDigest()); x.setDetectedMediaType(e.detectedMediaType()); x.setQualityOutcome(e.quality().rejected() ? "REJECT" : "PASS"); x.setQualityScore(e.quality().score()); x.setQualityReasonCodesSnapshot(e.quality().reasonCodes().toString()); x.setInferenceOutcomeType(e.outcomeType().name()); x.setPredictionSnapshot(e.predictionSnapshot() == null ? null : e.predictionSnapshot().toString()); x.setConfidenceSnapshot(e.predictionSnapshot() == null ? null : Double.toString(e.predictionSnapshot().calibratedProbability())); x.setSafetyAbstentionReasonCode(e.safetyAbstentionReasonCode() == null ? null : e.safetyAbstentionReasonCode().name()); x.setTechnicalFailureCode(e.technicalFailureCode() == null ? null : e.technicalFailureCode().name()); x.setOodSnapshot(e.oodSnapshot().toString()); x.setCalibrationSnapshot(e.calibrationSnapshot().toString()); x.setModelVersion(e.modelVersion()); x.setModelWeightFingerprint(e.modelFingerprint()); x.setPreprocessVersion(e.preprocessVersion()); x.setInferencePolicyVersion(e.inferencePolicyVersion()); x.setInferredAt(LocalDateTime.ofInstant(java.time.Instant.parse(e.inferredAt()), ZoneOffset.UTC)); x.setCreatedAt(LocalDateTime.now()); return x;
    }
}

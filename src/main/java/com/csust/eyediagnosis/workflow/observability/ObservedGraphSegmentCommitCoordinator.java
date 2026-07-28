package com.csust.eyediagnosis.workflow.observability;

import com.csust.eyediagnosis.workflow.audit.AuditEventType;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditEventDraft;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditRecorder;
import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.explanation.ExplanationPublicationDecision;
import com.csust.eyediagnosis.workflow.graph.runtime.DefaultGraphSegmentCommitCoordinator;
import com.csust.eyediagnosis.workflow.graph.runtime.EvidenceCitationDelta;
import com.csust.eyediagnosis.workflow.graph.runtime.ExplanationSnapshotDelta;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentCommitCoordinator;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentExecutionRequest;
import com.csust.eyediagnosis.workflow.graph.runtime.InferenceEnvelopeDelta;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentBusinessCommitPlan;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentCommitResult;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentExecutionResult;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;

/**
 * PR-12.1/12.2 observation decorator around the frozen commit coordinator. After a segment commit
 * has durably succeeded, it derives audit events (AI_INFERENCE_COMPLETED, EVIDENCE_VALIDATED,
 * EXPLANATION_PUBLISHED, RESULT_EXPOSED) and workflow/AI metrics from the already-committed plan.
 *
 * <p>Design constraints honored: the delegate's transaction, routing, and status semantics are
 * untouched; observation failures never poison the committed business result (they are logged and
 * counted instead).</p>
 */
@Service
@Primary
public class ObservedGraphSegmentCommitCoordinator implements GraphSegmentCommitCoordinator {

    private static final Logger log = LoggerFactory.getLogger(ObservedGraphSegmentCommitCoordinator.class);

    private final DefaultGraphSegmentCommitCoordinator delegate;
    private final WorkflowAuditRecorder auditRecorder;
    private final WorkflowMetrics metrics;
    private final DiagnosisWorkflowRepository workflowRepository;

    public ObservedGraphSegmentCommitCoordinator(DefaultGraphSegmentCommitCoordinator delegate,
                                                 WorkflowAuditRecorder auditRecorder,
                                                 WorkflowMetrics metrics,
                                                 DiagnosisWorkflowRepository workflowRepository) {
        this.delegate = delegate;
        this.auditRecorder = auditRecorder;
        this.metrics = metrics;
        this.workflowRepository = workflowRepository;
    }

    @Override
    public SegmentCommitResult commit(GraphSegmentExecutionRequest request, SegmentExecutionResult result) {
        SegmentCommitResult commitResult = delegate.commit(request, result);
        try {
            observe(request, result);
        } catch (RuntimeException exception) {
            metrics.auditWriteFailed();
            log.error("workflow audit/metrics observation failed after a durable segment commit; "
                    + "business state is unaffected. workflowId={}", request.workflowId(), exception);
        }
        return commitResult;
    }

    private void observe(GraphSegmentExecutionRequest request, SegmentExecutionResult result) {
        SegmentBusinessCommitPlan plan = result.businessCommitPlan();
        String segment = plan.persistedCurrentSegment().name();
        String workflowId = request.workflowId();

        observeDelta(workflowId, segment, plan);
        observeTerminal(workflowId, segment, plan);
    }

    private void observeDelta(String workflowId, String segment, SegmentBusinessCommitPlan plan) {
        if (plan.businessDelta() instanceof InferenceEnvelopeDelta delta) {
            InferenceEnvelope envelope = delta.envelope();
            auditRecorder.append(WorkflowAuditEventDraft.system(workflowId, AuditEventType.AI_INFERENCE_COMPLETED,
                    segment, "{\"outcomeType\":\"" + envelope.outcomeType().name()
                            + "\",\"modelVersion\":\"" + envelope.modelVersion() + "\"}"));
            if (envelope.outcomeType() == InferenceOutcomeType.SAFETY_ABSTENTION) {
                metrics.modelAbstained(envelope.safetyAbstentionReasonCode() == null
                        ? null : envelope.safetyAbstentionReasonCode().name());
            }
            if (envelope.outcomeType() == InferenceOutcomeType.TECHNICAL_FAILURE
                    && envelope.technicalFailureCode() == TechnicalFailureCode.GRPC_TIMEOUT) {
                metrics.inferenceTimeout();
            }
        } else if (plan.businessDelta() instanceof EvidenceCitationDelta delta) {
            auditRecorder.append(WorkflowAuditEventDraft.system(workflowId, AuditEventType.EVIDENCE_VALIDATED,
                    segment, "{\"validCitationCount\":" + delta.sufficiency().validCitationCount()
                            + ",\"sufficient\":" + delta.sufficiency().sufficient() + "}"));
            if (!delta.sufficiency().sufficient()) {
                metrics.evidenceValidationFailed();
            }
        } else if (plan.businessDelta() instanceof ExplanationSnapshotDelta delta
                && delta.decision() == ExplanationPublicationDecision.PUBLISH) {
            auditRecorder.append(WorkflowAuditEventDraft.system(workflowId, AuditEventType.EXPLANATION_PUBLISHED,
                    segment, "{\"validationStatus\":\"" + delta.validation().status().name() + "\"}"));
        }
    }

    private void observeTerminal(String workflowId, String segment, SegmentBusinessCommitPlan plan) {
        WorkflowStatus target = plan.targetWorkflowStatus();
        if (!target.isTerminal()) {
            return;
        }
        if (target == WorkflowStatus.FAILED) {
            metrics.workflowFailed();
        } else {
            metrics.workflowCompleted(target.name());
        }
        workflowRepository.findByWorkflowId(workflowId).ifPresent(workflow -> {
            if (workflow.getCreatedAt() != null) {
                metrics.workflowDuration(Duration.between(workflow.getCreatedAt(), LocalDateTime.now()));
            }
        });
        if (plan.exposureStatus() == PredictionExposureStatus.AVAILABLE) {
            auditRecorder.append(WorkflowAuditEventDraft.system(workflowId, AuditEventType.RESULT_EXPOSED,
                    segment, "{\"exposureStatus\":\"AVAILABLE\",\"terminalStatus\":\"" + target.name() + "\"}"));
        }
    }
}

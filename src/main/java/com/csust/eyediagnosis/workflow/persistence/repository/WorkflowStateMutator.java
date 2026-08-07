package com.csust.eyediagnosis.workflow.persistence.repository;

import com.csust.eyediagnosis.workflow.contract.CreateWorkflowCommand;
import com.csust.eyediagnosis.workflow.contract.RecordEventCommand;
import com.csust.eyediagnosis.workflow.contract.WorkflowEventBuilder;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Persistence façade for workflow state mutations — the single place that talks to the workflow and
 * event repositories for state changes, so the api/review command surfaces no longer hand-build
 * entities or invoke the wide-signature compare-and-swap directly.
 *
 * <p>Scope is strictly the persistence primitives (insert workflow, append event, transition
 * status). This class deliberately does NOT touch the frozen graph/runtime, nor the
 * {@code WorkflowStatus} / {@code ReviewDecision} / {@code GraphDefinition} identifiers, nor the
 * external API contract.</p>
 */
@Repository
public class WorkflowStateMutator {

    private static final String INITIAL_SEGMENT = SegmentCode.INTAKE_INFERENCE_QUALITY.name();

    private final DiagnosisWorkflowRepository workflowRepository;
    private final WorkflowEventRepository eventRepository;

    public WorkflowStateMutator(DiagnosisWorkflowRepository workflowRepository,
                                WorkflowEventRepository eventRepository) {
        this.workflowRepository = workflowRepository;
        this.eventRepository = eventRepository;
    }

    /**
     * Persist the initial CREATED workflow row. Callers own the idempotency check, initial job
     * creation and the subsequent CREATED&#8594;QUEUED transition.
     */
    public String createWorkflow(CreateWorkflowCommand cmd) {
        DiagnosisWorkflowEntity entity = new DiagnosisWorkflowEntity();
        entity.setWorkflowId(cmd.workflowId());
        entity.setOwnerUserId(cmd.ownerUserId());
        entity.setCreationIdempotencyKey(cmd.idempotencyKey());
        entity.setStatus(WorkflowStatus.CREATED.name());
        entity.setCurrentSegmentCode(INITIAL_SEGMENT);
        entity.setGraphDefinitionVersion(cmd.graphDefinitionVersion());
        entity.setGraphDefinitionHash(cmd.graphDefinitionHash());
        entity.setActionVersion(cmd.actionVersion());
        entity.setWorkflowVersion(0L);
        entity.setInferenceEpoch(0L);
        entity.setInferenceEnvelopeId(null);
        entity.setExplanationPublicationStatus(ExplanationPublicationStatus.NONE.name());
        entity.setPredictionExposureStatus(PredictionExposureStatus.NOT_AVAILABLE.name());
        entity.setStopReasonCode(null);
        entity.setLimitationReasonCode(null);
        entity.setQuestionText(cmd.questionText());
        workflowRepository.insert(entity);
        return cmd.workflowId();
    }

    /** Single append seam for workflow events. */
    public void recordEvent(RecordEventCommand cmd) {
        DiagnosisWorkflowEventEntity event = new DiagnosisWorkflowEventEntity();
        event.setEventId(UUID.randomUUID().toString());
        event.setWorkflowId(cmd.workflowId());
        event.setEventSequence(cmd.eventSequence());
        event.setEventType(cmd.eventType());
        event.setActorType(cmd.actorType());
        event.setActorId(cmd.actorId());
        event.setWorkflowVersion(cmd.workflowVersion());
        event.setSegmentCode(cmd.segmentCode());
        event.setReasonCode(cmd.reasonCode());
        event.setPayloadSnapshot(cmd.payloadSnapshot());
        eventRepository.append(event);
    }

    /**
     * Converged compare-and-swap transition. Consumes {@link WorkflowStatus} enums and reloads the
     * current publication / exposure / stop / limitation codes, so callers never pass the wide
     * (9-argument) signature.
     */
    public int transitionStatus(String workflowId, long expectedVersion, WorkflowStatus expectedStatus,
                                WorkflowStatus targetStatus, String segmentCode) {
        DiagnosisWorkflowEntity latest = workflowRepository.findByWorkflowId(workflowId)
                .orElseThrow(() -> new IllegalStateException(
                        "Workflow " + workflowId + " does not exist; cannot transition status"));
        return workflowRepository.updateStateIfVersionMatches(workflowId, expectedVersion,
                expectedStatus.name(), targetStatus.name(), segmentCode,
                latest.getExplanationPublicationStatus(), latest.getPredictionExposureStatus(),
                latest.getStopReasonCode(), latest.getLimitationReasonCode());
    }
}

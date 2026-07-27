package com.csust.eyediagnosis.workflow.api;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.enums.UserRole;
import com.csust.eyediagnosis.model.vo.workflow.DoctorInferenceView;
import com.csust.eyediagnosis.model.vo.workflow.PatientInferenceView;
import com.csust.eyediagnosis.model.vo.workflow.WorkflowEventView;
import com.csust.eyediagnosis.model.vo.workflow.WorkflowStatusView;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.InferenceEnvelopeEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.InferenceEnvelopeRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Read-side aggregation for the workflow REST surface. Assembles the status view and event
 * timeline from the frozen repositories and applies the role-gated result projection.
 */
@Service
public class WorkflowQueryService {

    private static final Map<String, String> SEGMENT_DISPLAY = Map.of(
            SegmentCode.INTAKE_INFERENCE_QUALITY.name(), "Image Quality & Intake",
            SegmentCode.QUALITY_REVIEW_RESUME.name(), "Quality Review",
            SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION.name(), "Evidence Retrieval",
            SegmentCode.FINAL_RISK_EXPLANATION.name(), "Risk & Explanation",
            SegmentCode.FINAL_CLINICAL_REVIEW_RESUME.name(), "Clinical Review");

    private final DiagnosisWorkflowRepository workflowRepository;
    private final WorkflowJobRepository workflowJobRepository;
    private final InferenceEnvelopeRepository inferenceEnvelopeRepository;
    private final WorkflowEventRepository eventRepository;
    private final WorkflowApiExposureGuard guard;

    public WorkflowQueryService(DiagnosisWorkflowRepository workflowRepository,
                                WorkflowJobRepository workflowJobRepository,
                                InferenceEnvelopeRepository inferenceEnvelopeRepository,
                                WorkflowEventRepository eventRepository,
                                WorkflowApiExposureGuard guard) {
        this.workflowRepository = workflowRepository;
        this.workflowJobRepository = workflowJobRepository;
        this.inferenceEnvelopeRepository = inferenceEnvelopeRepository;
        this.eventRepository = eventRepository;
        this.guard = guard;
    }

    public WorkflowStatusView getStatusView(String workflowId, User loginUser) {
        DiagnosisWorkflowEntity workflow = requireWorkflow(workflowId);
        guard.assertWorkflowReadable(workflow, loginUser);

        WorkflowStatusView view = new WorkflowStatusView();
        view.setWorkflowId(workflow.getWorkflowId());
        view.setStatus(workflow.getStatus());
        view.setSegment(workflow.getCurrentSegmentCode());

        WorkflowStatusView.Progress progress = new WorkflowStatusView.Progress();
        progress.setCurrent(displaySegment(workflow.getCurrentSegmentCode()));
        progress.setCompleted(completedSegmentDisplays(workflow.getWorkflowId()));
        view.setProgress(progress);

        WorkflowStatusView.ResultAvailability availability = new WorkflowStatusView.ResultAvailability();
        availability.setPatientVisible(isPatientVisible(workflow));
        availability.setDoctorReviewRequired(WorkflowStatus.WAITING_HUMAN_REVIEW.name().equals(workflow.getStatus()));
        view.setResultAvailability(availability);

        view.setResult(buildResult(workflow, loginUser));
        return view;
    }

    public List<WorkflowEventView> getEvents(String workflowId, User loginUser) {
        DiagnosisWorkflowEntity workflow = requireWorkflow(workflowId);
        guard.assertWorkflowReadable(workflow, loginUser);
        return eventRepository.findByWorkflowIdOrderBySequence(workflowId).stream().map(event -> {
            WorkflowEventView v = new WorkflowEventView();
            v.setType(event.getEventType());
            v.setTime(event.getOccurredAt());
            v.setSegment(event.getSegmentCode());
            return v;
        }).toList();
    }

    private List<String> completedSegmentDisplays(String workflowId) {
        return workflowJobRepository.findByWorkflowId(workflowId).stream()
                .filter(job -> WorkflowJobStatus.SUCCEEDED.name().equals(job.getStatus()))
                .map(WorkflowJobEntity::getSegmentCode)
                .map(this::displaySegment)
                .toList();
    }

    private Object buildResult(DiagnosisWorkflowEntity workflow, User loginUser) {
        if (workflow.getInferenceEpoch() == null || workflow.getInferenceEpoch() <= 0) {
            return null;
        }
        InferenceEnvelopeEntity envelope = inferenceEnvelopeRepository
                .findByWorkflowIdAndEpoch(workflow.getWorkflowId(), workflow.getInferenceEpoch())
                .orElse(null);
        if (envelope == null) {
            return null;
        }
        UserRole role = UserRole.getEnumByValue(loginUser.getUserRole());
        if (role == UserRole.DOCTOR || role == UserRole.ADMIN) {
            return toDoctorView(envelope);
        }
        if (isPatientVisible(workflow)
                && InferenceOutcomeType.VALID_PREDICTION.name().equals(envelope.getInferenceOutcomeType())) {
            return toPatientView(envelope);
        }
        return null;
    }

    private boolean isPatientVisible(DiagnosisWorkflowEntity workflow) {
        return workflow.getInferenceEpoch() != null && workflow.getInferenceEpoch() > 0
                && PredictionExposureStatus.AVAILABLE.name().equals(workflow.getPredictionExposureStatus());
    }

    private DoctorInferenceView toDoctorView(InferenceEnvelopeEntity e) {
        DoctorInferenceView v = new DoctorInferenceView();
        v.setInferenceOutcomeType(e.getInferenceOutcomeType());
        v.setImageObjectReference(e.getImageObjectReference());
        v.setQualityOutcome(e.getQualityOutcome());
        v.setQualityScore(e.getQualityScore());
        v.setQualityReasonCodesSnapshot(e.getQualityReasonCodesSnapshot());
        v.setPredictionSnapshot(e.getPredictionSnapshot());
        v.setConfidenceSnapshot(e.getConfidenceSnapshot());
        v.setOodSnapshot(e.getOodSnapshot());
        v.setCalibrationSnapshot(e.getCalibrationSnapshot());
        v.setSafetyAbstentionReasonCode(e.getSafetyAbstentionReasonCode());
        v.setTechnicalFailureCode(e.getTechnicalFailureCode());
        v.setModelVersion(e.getModelVersion());
        v.setModelWeightFingerprint(e.getModelWeightFingerprint());
        v.setPreprocessVersion(e.getPreprocessVersion());
        v.setInferencePolicyVersion(e.getInferencePolicyVersion());
        v.setInferredAt(e.getInferredAt() == null ? null : e.getInferredAt().toString());
        return v;
    }

    private PatientInferenceView toPatientView(InferenceEnvelopeEntity e) {
        String raw = e.getPredictionSnapshot();
        if (raw == null) {
            return null;
        }
        try {
            String body = raw.substring(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
            String[] parts = body.split(", ");
            String diseaseCode = parts[0].substring(parts[0].indexOf('=') + 1);
            double probability = Double.parseDouble(parts[1].substring(parts[1].indexOf('=') + 1));
            PatientInferenceView v = new PatientInferenceView();
            v.setDiseaseCode(diseaseCode);
            v.setCalibratedProbability(probability);
            return v;
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private String displaySegment(String segmentCode) {
        return segmentCode == null ? null : SEGMENT_DISPLAY.getOrDefault(segmentCode, segmentCode);
    }

    private DiagnosisWorkflowEntity requireWorkflow(String workflowId) {
        return workflowRepository.findByWorkflowId(workflowId)
                .orElseThrow(() -> new BusinessException(ErrorCode.NOT_FOUND_ERROR, "诊断工作流不存在"));
    }
}

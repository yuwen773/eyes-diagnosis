package com.csust.eyediagnosis.workflow.api;

import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.workflow.DoctorInferenceView;
import com.csust.eyediagnosis.model.vo.workflow.PatientInferenceView;
import com.csust.eyediagnosis.model.vo.workflow.WorkflowStatusView;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.InferenceEnvelopeEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.InferenceEnvelopeRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

/**
 * PR-10 security requirement: the patient-facing result projection must never leak raw
 * prediction snapshots, Top-K lists, model scores or abstention reasons. Only doctors/admins may
 * see the full inference envelope.
 */
class WorkflowQueryServiceResultLeakTest {

    @Mock
    private DiagnosisWorkflowRepository workflowRepository;
    @Mock
    private WorkflowJobRepository workflowJobRepository;
    @Mock
    private InferenceEnvelopeRepository inferenceEnvelopeRepository;
    @Mock
    private WorkflowEventRepository eventRepository;

    private WorkflowQueryService queryService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        queryService = new WorkflowQueryService(workflowRepository, workflowJobRepository,
                inferenceEnvelopeRepository, eventRepository, new WorkflowApiExposureGuard());
    }

    private User user(long id, String role) {
        User u = new User();
        u.setId(id);
        u.setUserRole(role);
        return u;
    }

    private DiagnosisWorkflowEntity workflow(long owner, String status, String exposure, long epoch) {
        DiagnosisWorkflowEntity e = new DiagnosisWorkflowEntity();
        e.setWorkflowId("wf_1");
        e.setOwnerUserId(owner);
        e.setStatus(status);
        e.setCurrentSegmentCode("FINAL_RISK_EXPLANATION");
        e.setPredictionExposureStatus(exposure);
        e.setInferenceEpoch(epoch);
        return e;
    }

    private InferenceEnvelopeEntity envelope(String outcomeType) {
        InferenceEnvelopeEntity e = new InferenceEnvelopeEntity();
        e.setInferenceEnvelopeId("env_1");
        e.setWorkflowId("wf_1");
        e.setInferenceEpoch(1L);
        e.setInferenceOutcomeType(outcomeType);
        e.setPredictionSnapshot("[diseaseCode=DIABETIC_RETINOPATHY, calibratedProbability=0.91, rank=1]");
        e.setConfidenceSnapshot("{\"topK\":[{\"code\":\"DR\",\"modelScore\":0.97}]}");
        e.setOodSnapshot("{\"oodScore\":0.02}");
        e.setCalibrationSnapshot("{\"temperature\":1.2}");
        e.setSafetyAbstentionReasonCode("LOW_CONFIDENCE");
        e.setModelVersion("efficientnet-b4-v3");
        e.setModelWeightFingerprint("fp_abc");
        e.setQualityOutcome("PASS");
        e.setQualityScore(92);
        return e;
    }

    private void stubWorkflow(DiagnosisWorkflowEntity wf, InferenceEnvelopeEntity env) {
        when(workflowRepository.findByWorkflowId("wf_1")).thenReturn(Optional.of(wf));
        when(workflowJobRepository.findByWorkflowId("wf_1")).thenReturn(List.of());
        if (env != null) {
            when(inferenceEnvelopeRepository.findByWorkflowIdAndEpoch("wf_1", 1L))
                    .thenReturn(Optional.of(env));
        }
    }

    @Test
    void patientSeesOnlyDiseaseCodeAndCalibratedProbability() throws Exception {
        stubWorkflow(workflow(1L, "COMPLETED", "AVAILABLE", 1L), envelope("VALID_PREDICTION"));

        WorkflowStatusView view = queryService.getStatusView("wf_1", user(1L, "user"));

        assertInstanceOf(PatientInferenceView.class, view.getResult());
        PatientInferenceView result = (PatientInferenceView) view.getResult();
        assertEquals("DIABETIC_RETINOPATHY", result.getDiseaseCode());
        assertEquals(0.91, result.getCalibratedProbability(), 1e-9);

        String json = objectMapper.writeValueAsString(view);
        assertFalse(json.contains("predictionSnapshot"), "raw prediction must not leak to patient");
        assertFalse(json.contains("topK"), "TopK must not leak to patient");
        assertFalse(json.contains("modelScore"), "model score must not leak to patient");
        assertFalse(json.contains("LOW_CONFIDENCE"), "abstention reason must not leak to patient");
        assertFalse(json.contains("oodScore"), "OOD snapshot must not leak to patient");
        assertFalse(json.contains("efficientnet"), "model version must not leak to patient");
    }

    @Test
    void patientGetsNoResultWhileExposureNotAvailable() {
        stubWorkflow(workflow(1L, "RUNNING", "NOT_AVAILABLE", 1L), envelope("VALID_PREDICTION"));

        WorkflowStatusView view = queryService.getStatusView("wf_1", user(1L, "user"));

        assertNull(view.getResult());
        assertFalse(view.getResultAvailability().isPatientVisible());
    }

    @Test
    void patientGetsNoResultForAbstentionOutcome() {
        stubWorkflow(workflow(1L, "WAITING_HUMAN_REVIEW", "AVAILABLE", 1L),
                envelope("SAFETY_ABSTENTION"));

        WorkflowStatusView view = queryService.getStatusView("wf_1", user(1L, "user"));

        assertNull(view.getResult(), "abstention detail must never be projected to the patient");
        assertTrue(view.getResultAvailability().isDoctorReviewRequired());
    }

    @Test
    void doctorSeesFullEnvelopeProjection() {
        stubWorkflow(workflow(1L, "COMPLETED", "AVAILABLE", 1L), envelope("VALID_PREDICTION"));

        WorkflowStatusView view = queryService.getStatusView("wf_1", user(9L, "doctor"));

        assertInstanceOf(DoctorInferenceView.class, view.getResult());
        DoctorInferenceView result = (DoctorInferenceView) view.getResult();
        assertEquals("[diseaseCode=DIABETIC_RETINOPATHY, calibratedProbability=0.91, rank=1]",
                result.getPredictionSnapshot());
        assertEquals("efficientnet-b4-v3", result.getModelVersion());
        assertEquals("LOW_CONFIDENCE", result.getSafetyAbstentionReasonCode());
    }

    @Test
    void unparsablePredictionSnapshotDegradesToNullInsteadOfLeakingRaw() {
        InferenceEnvelopeEntity env = envelope("VALID_PREDICTION");
        env.setPredictionSnapshot("corrupted-snapshot-without-structure");
        stubWorkflow(workflow(1L, "COMPLETED", "AVAILABLE", 1L), env);

        WorkflowStatusView view = queryService.getStatusView("wf_1", user(1L, "user"));

        assertNull(view.getResult());
    }
}

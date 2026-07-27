package com.csust.eyediagnosis.model.vo.workflow;

import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * Aggregated workflow status view returned by {@code GET /api/diagnosis/workflows/{id}}.
 *
 * <p>{@code result} is role-gated: a {@link DoctorInferenceView} for doctor/admin callers,
 * a {@link PatientInferenceView} (or null) for the owning patient, never the raw internals.
 */
@Data
public class WorkflowStatusView implements Serializable {
    private String workflowId;
    private String status;
    private String segment;
    private Progress progress;
    private ResultAvailability resultAvailability;
    private Object result;

    @Data
    public static class Progress implements Serializable {
        private String current;
        private List<String> completed;
    }

    @Data
    public static class ResultAvailability implements Serializable {
        private boolean patientVisible;
        private boolean doctorReviewRequired;
    }
}

package com.csust.eyediagnosis.model.vo.workflow;

import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * Full inference result for clinical reviewers (doctor / admin). This intentionally exposes
 * the raw prediction snapshot, OOD/calibration detail, model provenance and abstention reasons
 * that must NEVER be returned to a patient.
 */
@Data
public class DoctorInferenceView implements Serializable {
    private String inferenceOutcomeType;
    private String imageObjectReference;
    private String qualityOutcome;
    private Integer qualityScore;
    private String qualityReasonCodesSnapshot;
    private String predictionSnapshot;
    private String confidenceSnapshot;
    private String oodSnapshot;
    private String calibrationSnapshot;
    private String safetyAbstentionReasonCode;
    private String technicalFailureCode;
    private String modelVersion;
    private String modelWeightFingerprint;
    private String preprocessVersion;
    private String inferencePolicyVersion;
    private String inferredAt;
}

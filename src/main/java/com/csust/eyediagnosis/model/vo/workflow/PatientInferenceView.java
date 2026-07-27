package com.csust.eyediagnosis.model.vo.workflow;

import lombok.Data;

import java.io.Serializable;

/**
 * Patient-safe projection of the inference result. Mirrors the project's sanctioned
 * {@code PatientPredictionProjection}: only disease code and calibrated probability are
 * exposed. Raw prediction, top-two margin, model score, OOD/calibration and abstention
 * reasons are withheld.
 */
@Data
public class PatientInferenceView implements Serializable {
    private String diseaseCode;
    private Double calibratedProbability;
}

package com.csust.eyediagnosis.workflow.domain;

/** Whether a patient projection may contain prediction details. */
public enum PredictionExposureStatus {
    NOT_AVAILABLE,
    WITHHELD_BY_QUALITY_GATE,
    AVAILABLE,
    WITHHELD_BY_ABSTENTION,
    WITHHELD_BY_OOD
}

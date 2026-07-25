package com.csust.eyediagnosis.workflow.domain;

/** Mutually exclusive result class for one logical inference epoch. */
public enum InferenceOutcomeType {
    VALID_PREDICTION,
    SAFETY_ABSTENTION,
    TECHNICAL_FAILURE
}

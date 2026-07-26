package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.persistence.entity.ExplanationSnapshotEntity;

public record ExplanationGenerationOutcome(Status status, ExplanationSnapshotEntity snapshot, String errorCode) {
    public enum Status { EXISTING, GENERATED, WITHHELD }
    public ExplanationGenerationOutcome {
        if (status == null || (status != Status.WITHHELD && snapshot == null) || (status == Status.WITHHELD && (errorCode == null || errorCode.isBlank()))) {
            throw new IllegalArgumentException("generation outcome is incomplete");
        }
    }
}

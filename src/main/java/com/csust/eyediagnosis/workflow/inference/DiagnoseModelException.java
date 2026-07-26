package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;

public final class DiagnoseModelException extends RuntimeException {
    private final TechnicalFailureCode failureCode;

    public DiagnoseModelException(TechnicalFailureCode failureCode, String message, Throwable cause) {
        super(message, cause);
        this.failureCode = failureCode;
    }

    public TechnicalFailureCode failureCode() { return failureCode; }
}

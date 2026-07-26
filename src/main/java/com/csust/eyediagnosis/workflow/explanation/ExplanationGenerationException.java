package com.csust.eyediagnosis.workflow.explanation;

public final class ExplanationGenerationException extends RuntimeException {
    public enum Code { EXPLANATION_MODEL_TIMEOUT, EXPLANATION_MODEL_UNAVAILABLE, EXPLANATION_MODEL_PROTOCOL_ERROR, EXPLANATION_INVALID_STRUCTURED_OUTPUT, EXPLANATION_GENERATION_OUTCOME_UNKNOWN }
    private final Code code;
    public ExplanationGenerationException(Code code, String message, Throwable cause) { super(message, cause); this.code = code; }
    public Code code() { return code; }
}

package com.csust.eyediagnosis.workflow.explanation;

public record ExplanationModelResult(ExplanationDraft draft) {
    public ExplanationModelResult { if (draft == null) throw new IllegalArgumentException("model draft is required"); }
}

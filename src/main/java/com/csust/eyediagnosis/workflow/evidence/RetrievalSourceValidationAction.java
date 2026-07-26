package com.csust.eyediagnosis.workflow.evidence;

import org.springframework.stereotype.Component;

@Component
public final class RetrievalSourceValidationAction {
    private final RetrievalSourceValidator validator;
    public RetrievalSourceValidationAction(RetrievalSourceValidator validator) { this.validator = validator; }
    public ValidatedEvidenceBatch execute(EvidenceRetrievalIntent intent, EvidenceRetrievalBatch batch) { return validator.validate(intent, batch); }
}

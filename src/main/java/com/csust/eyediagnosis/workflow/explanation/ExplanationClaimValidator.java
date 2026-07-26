package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import java.util.List;

public interface ExplanationClaimValidator {
    ExplanationClaimValidationResult validate(ExplanationDraft draft, List<DiagnosisCitationSnapshot> citations,
                                              PatientPredictionProjection prediction);
}

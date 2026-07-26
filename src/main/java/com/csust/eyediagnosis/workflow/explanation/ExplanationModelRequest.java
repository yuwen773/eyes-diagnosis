package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import java.util.List;

/** Deliberately bounded model payload: no question, image, hidden predictions, or graph state. */
public record ExplanationModelRequest(PatientPredictionProjection prediction, List<DiagnosisCitationSnapshot> citations,
                                      String policyVersion, String promptVersion) {
    public ExplanationModelRequest { citations = citations == null ? List.of() : List.copyOf(citations); }
}

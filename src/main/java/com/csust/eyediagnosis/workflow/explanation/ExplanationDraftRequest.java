package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiency;
import java.util.List;

public record ExplanationDraftRequest(String workflowId, long inferenceEpoch, long explanationRevision,
                                      PatientPredictionProjection prediction, List<DiagnosisCitationSnapshot> citations,
                                      EvidenceSufficiency evidenceSufficiency, String explanationPolicyVersion,
                                      String promptVersion) {
    public ExplanationDraftRequest {
        if (workflowId == null || workflowId.isBlank() || inferenceEpoch < 0 || explanationRevision <= 0 || prediction == null
                || evidenceSufficiency == null || !evidenceSufficiency.sufficient() || explanationPolicyVersion == null || explanationPolicyVersion.isBlank()
                || promptVersion == null || promptVersion.isBlank()) throw new IllegalArgumentException("draft request violates evidence boundary");
        citations = citations == null ? List.of() : List.copyOf(citations);
        if (citations.isEmpty() || citations.stream().anyMatch(c -> !workflowId.equals(c.workflowId()))) throw new IllegalArgumentException("draft requires accepted workflow citations");
    }
}

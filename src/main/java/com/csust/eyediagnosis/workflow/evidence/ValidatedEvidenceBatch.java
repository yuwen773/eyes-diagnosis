package com.csust.eyediagnosis.workflow.evidence;

import java.util.List;
import java.util.Set;

public record ValidatedEvidenceBatch(List<DiagnosisCitationSnapshot> citations, EvidenceSufficiency sufficiency,
                                     Set<RetrievalValidationFailure> failures) {
    public ValidatedEvidenceBatch { citations = citations == null ? List.of() : List.copyOf(citations); failures = failures == null ? Set.of() : Set.copyOf(failures); }
}

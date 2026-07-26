package com.csust.eyediagnosis.workflow.explanation;

import java.util.Set;

public record ExplanationClaim(String claimId, ExplanationClaimType type, String text, Set<String> citationIds) {
    public ExplanationClaim {
        if (claimId == null || claimId.isBlank() || type == null || text == null || text.isBlank()) throw new IllegalArgumentException("claim is incomplete");
        citationIds = citationIds == null ? Set.of() : Set.copyOf(citationIds);
    }
}

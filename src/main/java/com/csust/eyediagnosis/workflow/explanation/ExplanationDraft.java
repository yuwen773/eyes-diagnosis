package com.csust.eyediagnosis.workflow.explanation;

import java.util.List;

/** Persistable final output only; internal model reasoning is intentionally not represented. */
public record ExplanationDraft(String summary, List<ExplanationClaim> claims, String safetyNotice,
                               String modelVersion, String promptVersion, String policyVersion) {
    public ExplanationDraft {
        if (summary == null || summary.isBlank() || summary.length() > 2000 || safetyNotice == null || safetyNotice.isBlank()
                || modelVersion == null || modelVersion.isBlank() || promptVersion == null || promptVersion.isBlank()
                || policyVersion == null || policyVersion.isBlank()) throw new IllegalArgumentException("draft is incomplete");
        claims = claims == null ? List.of() : List.copyOf(claims);
        if (claims.size() > 12) throw new IllegalArgumentException("too many explanation claims");
    }
}

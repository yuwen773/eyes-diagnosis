package com.csust.eyediagnosis.workflow.evidence;

import java.util.Set;

public record EvidenceSufficiency(int validCitationCount, Set<String> coveredDiseaseCodes, Set<String> coveredTopicCodes,
                                  boolean sufficient, EvidenceSufficiencyReasonCode reasonCode) {
    public EvidenceSufficiency {
        coveredDiseaseCodes = coveredDiseaseCodes == null ? Set.of() : Set.copyOf(coveredDiseaseCodes);
        coveredTopicCodes = coveredTopicCodes == null ? Set.of() : Set.copyOf(coveredTopicCodes);
        if (validCitationCount < 0 || reasonCode == null) throw new IllegalArgumentException("invalid evidence sufficiency");
    }
    public EvidenceSufficiency exhausted() { return new EvidenceSufficiency(validCitationCount, coveredDiseaseCodes, coveredTopicCodes, false, EvidenceSufficiencyReasonCode.REWRITE_EXHAUSTED); }
}

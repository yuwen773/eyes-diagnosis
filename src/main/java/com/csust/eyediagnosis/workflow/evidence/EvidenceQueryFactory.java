package com.csust.eyediagnosis.workflow.evidence;

import java.util.LinkedHashSet;
import java.util.Set;

public final class EvidenceQueryFactory {
    private EvidenceQueryFactory() { }
    public static EvidenceQuery initial(EvidenceRetrievalIntent intent, EvidenceTermCatalog catalog) {
        Set<String> terms = new LinkedHashSet<>();
        intent.diseaseCodes().forEach(code -> terms.add(catalog.termsForDiseaseCode(code).stream().sorted().findFirst().orElseThrow()));
        intent.topicCodes().forEach(code -> terms.add(catalog.termsForTopicCode(code).stream().sorted().findFirst().orElseThrow()));
        return new EvidenceQuery(intent.diseaseCodes(), intent.topicCodes(), terms, intent.requestedTopK(), 0);
    }
}

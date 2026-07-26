package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;
import org.springframework.stereotype.Component;
import java.util.LinkedHashSet;
import java.util.Set;

@Component
public final class CatalogEvidenceQueryRewriter implements ControlledEvidenceQueryRewriter {
    private final EvidenceTermCatalog catalog;
    public CatalogEvidenceQueryRewriter(EvidenceTermCatalog catalog) { this.catalog = catalog; }
    @Override public EvidenceQuery rewrite(EvidenceQuery original) {
        if (original.rewriteAttempt() != 0) throw new InvalidWorkflowContractException("query rewrite is exhausted");
        Set<String> terms = new LinkedHashSet<>(original.controlledTerms());
        original.diseaseCodes().forEach(code -> terms.addAll(catalog.termsForDiseaseCode(code)));
        original.topicCodes().forEach(code -> terms.addAll(catalog.termsForTopicCode(code)));
        return new EvidenceQuery(original.diseaseCodes(), original.topicCodes(), terms, original.topK(), 1);
    }
}

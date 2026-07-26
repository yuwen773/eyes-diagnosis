package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.contract.VisionExposureOutput;
import org.springframework.stereotype.Component;

/** Graph-level routing owner for the one permitted rewrite. The actions never select a successor. */
@Component
public final class EvidenceRetrievalGovernanceGraph {
    private final EvidenceRetrievalAction retrieval; private final RetrievalSourceValidationAction validation; private final QueryRewriteAction rewrite;
    public EvidenceRetrievalGovernanceGraph(EvidenceRetrievalAction retrieval, RetrievalSourceValidationAction validation, QueryRewriteAction rewrite) { this.retrieval = retrieval; this.validation = validation; this.rewrite = rewrite; }
    public EvidenceRetrievalGraphResult execute(InferenceEnvelope envelope, VisionExposureOutput exposure) {
        EvidenceRetrievalBatch first = retrieval.execute(envelope, exposure);
        if (first.skipped()) return new EvidenceRetrievalGraphResult(validation.execute(first.intent(), first), 0, 0);
        ValidatedEvidenceBatch checked = validation.execute(first.intent(), first);
        if (checked.sufficiency().sufficient()) return new EvidenceRetrievalGraphResult(checked, 1, 0);
        EvidenceQuery rewritten = rewrite.execute(first.query());
        ValidatedEvidenceBatch exhausted = validation.execute(first.intent(), retrieval.execute(first.intent(), rewritten));
        if (!exhausted.sufficiency().sufficient()) exhausted = new ValidatedEvidenceBatch(exhausted.citations(), exhausted.sufficiency().exhausted(), exhausted.failures());
        return new EvidenceRetrievalGraphResult(exhausted, 2, 1);
    }
}

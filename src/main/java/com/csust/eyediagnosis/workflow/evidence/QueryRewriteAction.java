package com.csust.eyediagnosis.workflow.evidence;

import org.springframework.stereotype.Component;

@Component
public final class QueryRewriteAction {
    private final ControlledEvidenceQueryRewriter rewriter;
    public QueryRewriteAction(ControlledEvidenceQueryRewriter rewriter) { this.rewriter = rewriter; }
    public EvidenceQuery execute(EvidenceQuery query) { return rewriter.rewrite(query); }
}

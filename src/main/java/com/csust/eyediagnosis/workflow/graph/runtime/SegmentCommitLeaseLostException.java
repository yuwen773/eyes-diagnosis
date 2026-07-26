package com.csust.eyediagnosis.workflow.graph.runtime;

/** The claimed worker's fence no longer owns the job; the graph result must not be committed. */
public final class SegmentCommitLeaseLostException extends SegmentCommitFailureException {
    public SegmentCommitLeaseLostException(String message) {
        super(message);
    }
}

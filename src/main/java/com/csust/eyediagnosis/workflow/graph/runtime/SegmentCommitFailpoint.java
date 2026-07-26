package com.csust.eyediagnosis.workflow.graph.runtime;

/** Test-only seam for proving the enclosing commit transaction rolls back. */
public interface SegmentCommitFailpoint {
    void beforeResumeJobCreation();
}

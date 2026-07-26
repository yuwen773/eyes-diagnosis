package com.csust.eyediagnosis.workflow.graph.runtime;

public interface SegmentBusinessDeltaDispatcher {
    void persist(SegmentBusinessDelta delta);
}

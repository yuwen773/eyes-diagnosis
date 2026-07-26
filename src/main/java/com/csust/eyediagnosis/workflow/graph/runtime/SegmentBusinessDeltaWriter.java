package com.csust.eyediagnosis.workflow.graph.runtime;

public interface SegmentBusinessDeltaWriter<T extends SegmentBusinessDelta> {
    Class<T> supportedType();

    void write(T delta);
}

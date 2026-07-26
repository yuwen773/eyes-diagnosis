package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;

public record InferenceEnvelopeDelta(InferenceEnvelope envelope, NodeExecutionCompletion nodeExecution,
                                     long expectedWorkflowVersion) implements SegmentBusinessDelta {
    public InferenceEnvelopeDelta {
        if (envelope == null || nodeExecution == null || expectedWorkflowVersion < 0) throw new IllegalArgumentException("inference envelope delta must be complete");
    }
}

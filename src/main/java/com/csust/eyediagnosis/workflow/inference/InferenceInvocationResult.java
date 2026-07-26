package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.graph.runtime.NodeExecutionCompletion;

/** Completion is present only for the worker that owns the reservation and must create the delta. */
public record InferenceInvocationResult(InferenceEnvelope envelope, NodeExecutionCompletion nodeExecutionCompletion) {
    public InferenceInvocationResult { if (envelope == null) throw new IllegalArgumentException("envelope is required"); }
}

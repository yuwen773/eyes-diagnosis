package com.csust.eyediagnosis.workflow.graph.runtime;

import java.util.Map;

/** A typed boundary around Graph Core's map-shaped state. */
public interface GraphSegmentInput {
    Map<String, Object> toGraphState();
}

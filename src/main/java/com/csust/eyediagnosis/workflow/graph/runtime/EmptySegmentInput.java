package com.csust.eyediagnosis.workflow.graph.runtime;

import java.util.Map;

public record EmptySegmentInput() implements GraphSegmentInput {
    @Override
    public Map<String, Object> toGraphState() {
        return Map.of();
    }
}

package com.csust.eyediagnosis.workflow.graph.definition;

public record GraphConditionalEdgeSpec(String sourceNodeCode, String conditionCode, String targetNodeCode) {
}

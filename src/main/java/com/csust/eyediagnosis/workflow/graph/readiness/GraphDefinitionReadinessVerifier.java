package com.csust.eyediagnosis.workflow.graph.readiness;

public interface GraphDefinitionReadinessVerifier {
    GraphDefinitionReadinessReport verifyNonTerminalWorkflows();
}

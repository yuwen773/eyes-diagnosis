package com.csust.eyediagnosis.workflow.graph.readiness;

import java.util.Set;

public record GraphDefinitionReadinessReport(int checkedWorkflowCount, Set<String> requiredDefinitionVersions) {
    public GraphDefinitionReadinessReport {
        requiredDefinitionVersions = Set.copyOf(requiredDefinitionVersions);
    }
}

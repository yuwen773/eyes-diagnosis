package com.csust.eyediagnosis.workflow.graph.definition;

public interface DiagnosisGraphDefinition {
    String graphId();
    String definitionVersion();
    String definitionHash();
    String actionVersion();
    GraphDefinitionManifest manifest();
}

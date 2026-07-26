package com.csust.eyediagnosis.workflow.graph.definition;

import java.util.Objects;

public final class DiagnosisGraphDefinitionFactory {
    private DiagnosisGraphDefinitionFactory() {
    }

    public static DiagnosisGraphDefinition create(GraphDefinitionManifest manifest, GraphDefinitionHasher hasher) {
        Objects.requireNonNull(manifest, "manifest");
        return new ImmutableDiagnosisGraphDefinition(manifest, Objects.requireNonNull(hasher, "hasher").hash(manifest));
    }

    private record ImmutableDiagnosisGraphDefinition(GraphDefinitionManifest manifest, String definitionHash) implements DiagnosisGraphDefinition {
        @Override public String graphId() { return manifest.graphId(); }
        @Override public String definitionVersion() { return manifest.definitionVersion(); }
        @Override public String actionVersion() { return manifest.actionVersion(); }
    }
}

package com.csust.eyediagnosis.workflow.graph.registry;

import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionDescriptor;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.exception.GraphActionVersionMismatchException;
import com.csust.eyediagnosis.workflow.graph.exception.GraphDefinitionHashMismatchException;
import com.csust.eyediagnosis.workflow.graph.exception.UnsupportedGraphDefinitionVersionException;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

@Component
public class InMemoryGraphDefinitionRegistry implements GraphDefinitionRegistry {
    private final Map<String, DiagnosisGraphDefinition> definitions;
    private final List<GraphDefinitionDescriptor> supported;

    public InMemoryGraphDefinitionRegistry(List<DiagnosisGraphDefinition> definitions, GraphDefinitionHasher hasher) {
        Objects.requireNonNull(definitions, "definitions");
        Objects.requireNonNull(hasher, "hasher");
        Map<String, DiagnosisGraphDefinition> indexed = new LinkedHashMap<>();
        for (DiagnosisGraphDefinition definition : definitions) {
            validateDefinition(definition, hasher);
            if (indexed.putIfAbsent(definition.definitionVersion(), definition) != null) {
                throw new IllegalArgumentException("Duplicate graph definition version: " + definition.definitionVersion());
            }
        }
        this.definitions = Map.copyOf(indexed);
        this.supported = this.definitions.values().stream()
                .map(definition -> new GraphDefinitionDescriptor(definition.definitionVersion(), definition.definitionHash(), definition.actionVersion()))
                .sorted(Comparator.comparing(GraphDefinitionDescriptor::definitionVersion)).toList();
    }

    @Override public DiagnosisGraphDefinition require(String definitionVersion) {
        if (definitionVersion == null || definitionVersion.isBlank()) throw new UnsupportedGraphDefinitionVersionException(definitionVersion);
        return find(definitionVersion).orElseThrow(() -> new UnsupportedGraphDefinitionVersionException(definitionVersion));
    }

    @Override public Optional<DiagnosisGraphDefinition> find(String definitionVersion) {
        return Optional.ofNullable(definitionVersion).filter(version -> !version.isBlank()).map(definitions::get);
    }

    @Override public Collection<GraphDefinitionDescriptor> listSupported() { return supported; }

    @Override public void verifyBinding(GraphDefinitionBinding binding) { requireExecutableDefinition(binding); }

    @Override public DiagnosisGraphDefinition requireExecutableDefinition(GraphDefinitionBinding binding) {
        if (binding == null) throw new UnsupportedGraphDefinitionVersionException(null);
        DiagnosisGraphDefinition definition = require(binding.definitionVersion());
        requireText(binding.definitionHash(), "definitionHash");
        requireText(binding.actionVersion(), "actionVersion");
        if (!definition.definitionHash().equals(binding.definitionHash())) throw new GraphDefinitionHashMismatchException(definition.definitionVersion());
        if (!definition.actionVersion().equals(binding.actionVersion())) throw new GraphActionVersionMismatchException(definition.definitionVersion());
        return definition;
    }

    private static void validateDefinition(DiagnosisGraphDefinition definition, GraphDefinitionHasher hasher) {
        Objects.requireNonNull(definition, "graphDefinition");
        requireText(definition.graphId(), "graphId");
        requireText(definition.definitionVersion(), "definitionVersion");
        requireText(definition.definitionHash(), "definitionHash");
        requireText(definition.actionVersion(), "actionVersion");
        if (!definition.graphId().equals(definition.manifest().graphId())
                || !definition.definitionVersion().equals(definition.manifest().definitionVersion())
                || !definition.actionVersion().equals(definition.manifest().actionVersion())
                || !definition.definitionHash().equals(hasher.hash(definition.manifest()))) {
            throw new IllegalArgumentException("Graph definition does not match its manifest");
        }
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " must not be blank");
    }
}

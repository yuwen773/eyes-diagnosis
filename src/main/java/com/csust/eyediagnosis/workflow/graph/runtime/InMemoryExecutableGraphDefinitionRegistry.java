package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.registry.GraphDefinitionRegistry;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class InMemoryExecutableGraphDefinitionRegistry implements ExecutableGraphDefinitionRegistry {
    private final GraphDefinitionRegistry manifestRegistry;
    private final Map<GraphDefinitionBinding, ExecutableDiagnosisGraphDefinition> definitions;

    public InMemoryExecutableGraphDefinitionRegistry(GraphDefinitionRegistry manifestRegistry,
                                                     List<ExecutableDiagnosisGraphDefinition> definitions) {
        this.manifestRegistry = manifestRegistry;
        Map<GraphDefinitionBinding, ExecutableDiagnosisGraphDefinition> indexed = new LinkedHashMap<>();
        for (ExecutableDiagnosisGraphDefinition definition : definitions) {
            GraphDefinitionBinding binding = definition.binding();
            DiagnosisGraphDefinition manifest = manifestRegistry.require(binding.definitionVersion());
            GraphDefinitionBinding manifestBinding = new GraphDefinitionBinding(manifest.definitionVersion(),
                    manifest.definitionHash(), manifest.actionVersion());
            if (!manifestBinding.equals(binding) || indexed.putIfAbsent(binding, definition) != null) {
                throw new IllegalArgumentException("Executable graph definition must have one exact registered manifest binding");
            }
        }
        this.definitions = Map.copyOf(indexed);
    }

    @Override
    public ExecutableDiagnosisGraphDefinition requireExact(GraphDefinitionBinding binding) {
        manifestRegistry.verifyBinding(binding);
        ExecutableDiagnosisGraphDefinition definition = definitions.get(binding);
        if (definition == null) {
            throw new GraphExecutableDefinitionMissingException(binding.definitionVersion());
        }
        return definition;
    }
}

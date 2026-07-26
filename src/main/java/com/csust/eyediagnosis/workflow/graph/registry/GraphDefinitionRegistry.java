package com.csust.eyediagnosis.workflow.graph.registry;

import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionDescriptor;

import java.util.Collection;
import java.util.Optional;

public interface GraphDefinitionRegistry {
    DiagnosisGraphDefinition require(String definitionVersion);
    Optional<DiagnosisGraphDefinition> find(String definitionVersion);
    Collection<GraphDefinitionDescriptor> listSupported();
    void verifyBinding(GraphDefinitionBinding binding);
    DiagnosisGraphDefinition requireExecutableDefinition(GraphDefinitionBinding binding);
}

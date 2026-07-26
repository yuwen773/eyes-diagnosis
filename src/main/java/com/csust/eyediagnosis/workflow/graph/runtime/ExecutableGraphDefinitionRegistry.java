package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;

public interface ExecutableGraphDefinitionRegistry {
    ExecutableDiagnosisGraphDefinition requireExact(GraphDefinitionBinding binding);
}

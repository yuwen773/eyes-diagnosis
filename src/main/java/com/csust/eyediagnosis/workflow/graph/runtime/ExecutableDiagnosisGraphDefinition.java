package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;

/** The executable counterpart of one immutable graph manifest binding. */
public interface ExecutableDiagnosisGraphDefinition {
    GraphDefinitionBinding binding();

    CompiledGraph compile(BaseCheckpointSaver checkpointSaver) throws Exception;
}

package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinitionFactory;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionManifest;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.definition.GraphEdgeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphNodeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphSegmentSpec;
import com.csust.eyediagnosis.workflow.graph.definition.Sha256GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.registry.InMemoryGraphDefinitionRegistry;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ExecutableGraphDefinitionRegistryTest {
    private final GraphDefinitionHasher hasher = new Sha256GraphDefinitionHasher();
    private final DiagnosisGraphDefinition definition = DiagnosisGraphDefinitionFactory.create(new GraphDefinitionManifest(
            "synthetic", "synthetic-v1", "actions-v1",
            List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("node", "ACTION"),
                    new GraphNodeSpec("END", "BOUNDARY")),
            List.of(new GraphEdgeSpec("START", "node"), new GraphEdgeSpec("node", "END")), List.of(),
            List.of(new GraphSegmentSpec(SegmentCode.INTAKE_INFERENCE_QUALITY, "START", "node")),
            List.of(), List.of("node")), hasher);

    @Test
    void requiresTheEntireRegisteredBindingWithoutFallback() {
        InMemoryGraphDefinitionRegistry manifests = new InMemoryGraphDefinitionRegistry(List.of(definition), hasher);
        ExecutableDiagnosisGraphDefinition executable = new StubExecutable(binding());
        InMemoryExecutableGraphDefinitionRegistry registry = new InMemoryExecutableGraphDefinitionRegistry(manifests, List.of(executable));

        assertSame(executable, registry.requireExact(binding()));
        assertThrows(RuntimeException.class, () -> registry.requireExact(new GraphDefinitionBinding("missing", binding().definitionHash(), binding().actionVersion())));
        assertThrows(RuntimeException.class, () -> registry.requireExact(new GraphDefinitionBinding(binding().definitionVersion(), "other", binding().actionVersion())));
        assertThrows(RuntimeException.class, () -> registry.requireExact(new GraphDefinitionBinding(binding().definitionVersion(), binding().definitionHash(), "other")));
    }

    @Test
    void rejectsDuplicateOrManifestMismatchedExecutableRegistration() {
        InMemoryGraphDefinitionRegistry manifests = new InMemoryGraphDefinitionRegistry(List.of(definition), hasher);
        assertThrows(IllegalArgumentException.class, () -> new InMemoryExecutableGraphDefinitionRegistry(manifests,
                List.of(new StubExecutable(binding()), new StubExecutable(binding()))));
        assertThrows(RuntimeException.class, () -> new InMemoryExecutableGraphDefinitionRegistry(manifests,
                List.of(new StubExecutable(new GraphDefinitionBinding(binding().definitionVersion(), "other", binding().actionVersion())))));
    }

    private GraphDefinitionBinding binding() {
        return new GraphDefinitionBinding(definition.definitionVersion(), definition.definitionHash(), definition.actionVersion());
    }

    private record StubExecutable(GraphDefinitionBinding binding) implements ExecutableDiagnosisGraphDefinition {
        @Override public CompiledGraph compile(BaseCheckpointSaver checkpointSaver) { throw new AssertionError("Registry lookup must not compile a graph"); }
    }
}

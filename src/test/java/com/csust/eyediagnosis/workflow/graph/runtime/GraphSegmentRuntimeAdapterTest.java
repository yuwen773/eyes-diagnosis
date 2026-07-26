package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.KeyStrategy;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinitionFactory;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionManifest;
import com.csust.eyediagnosis.workflow.graph.definition.GraphEdgeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphNodeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphSegmentSpec;
import com.csust.eyediagnosis.workflow.graph.definition.Sha256GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.registry.InMemoryGraphDefinitionRegistry;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GraphSegmentRuntimeAdapterTest {
    private final GraphDefinitionHasher hasher = new Sha256GraphDefinitionHasher();
    private final DiagnosisGraphDefinition definition = DiagnosisGraphDefinitionFactory.create(new GraphDefinitionManifest(
            "synthetic", "synthetic-v1", "actions-v1",
            List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("first", "ACTION"),
                    new GraphNodeSpec("resume", "ACTION"), new GraphNodeSpec("END", "BOUNDARY")),
            List.of(new GraphEdgeSpec("START", "first"), new GraphEdgeSpec("first", "resume"),
                    new GraphEdgeSpec("resume", "END")), List.of(),
            List.of(new GraphSegmentSpec(SegmentCode.INTAKE_INFERENCE_QUALITY, "START", "first"),
                    new GraphSegmentSpec(SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, "resume", "END")),
            List.of(), List.of("first")), hasher);

    @Test
    void startsAtPublicStartThenResumesWithoutRepeatingTheCompletedAction() {
        AtomicInteger firstRuns = new AtomicInteger();
        MemorySaver saver = new MemorySaver();
        GraphDefinitionBinding binding = binding();
        ExecutableDiagnosisGraphDefinition executable = executable(binding, firstRuns);
        DefaultGraphSegmentRuntimeAdapter adapter = new DefaultGraphSegmentRuntimeAdapter(
                new InMemoryGraphDefinitionRegistry(List.of(definition), hasher),
                new InMemoryExecutableGraphDefinitionRegistry(new InMemoryGraphDefinitionRegistry(List.of(definition), hasher), List.of(executable)),
                () -> saver, new ManifestGraphSegmentBoundaryResolver());

        SegmentExecutionResult started = adapter.execute(startRequest(binding));

        assertEquals(GraphRuntimeDisposition.INTERRUPTED, started.disposition());
        assertEquals("resume", started.publicNextNode());
        assertEquals(SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, started.nextSegment());
        assertEquals(1, firstRuns.get());

        SegmentExecutionResult resumed = adapter.execute(new ResumeGraphSegmentRequest("wf-1", 1,
                new LeasedJobFence("job-2", "worker", "token-2", 1, 1), binding,
                SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, 0, started.recoveryToken(), new EmptySegmentInput()));

        assertEquals(GraphRuntimeDisposition.COMPLETED, resumed.disposition());
        assertEquals(StateGraph.END, resumed.publicNextNode());
        assertEquals(1, firstRuns.get());
    }

    @Test
    void rejectsBindingMismatchBeforeAnyGraphActionRuns() {
        AtomicInteger firstRuns = new AtomicInteger();
        GraphDefinitionBinding binding = binding();
        InMemoryGraphDefinitionRegistry manifests = new InMemoryGraphDefinitionRegistry(List.of(definition), hasher);
        DefaultGraphSegmentRuntimeAdapter adapter = new DefaultGraphSegmentRuntimeAdapter(manifests,
                new InMemoryExecutableGraphDefinitionRegistry(manifests, List.of(executable(binding, firstRuns))),
                MemorySaver::new, new ManifestGraphSegmentBoundaryResolver());

        assertThrows(RuntimeException.class, () -> adapter.execute(startRequest(new GraphDefinitionBinding(
                binding.definitionVersion(), binding.definitionHash(), "wrong-actions"))));
        assertEquals(0, firstRuns.get());
    }

    private ExecutableDiagnosisGraphDefinition executable(GraphDefinitionBinding binding, AtomicInteger firstRuns) {
        return new ExecutableDiagnosisGraphDefinition() {
            @Override public GraphDefinitionBinding binding() { return binding; }

            @Override public CompiledGraph compile(BaseCheckpointSaver saver) throws Exception {
                return new StateGraph(KeyStrategy.builder()
                        .addStrategy(DefaultGraphSegmentRuntimeAdapter.BUSINESS_COMMIT_PLAN_KEY)
                        .build())
                        .addNode("first", state -> {
                            firstRuns.incrementAndGet();
                            return CompletableFuture.completedFuture(Map.of(DefaultGraphSegmentRuntimeAdapter.BUSINESS_COMMIT_PLAN_KEY, plan()));
                        })
                        .addNode("resume", state -> CompletableFuture.completedFuture(Map.of()))
                        .addEdge(StateGraph.START, "first")
                        .addEdge("first", "resume")
                        .addEdge("resume", StateGraph.END)
                        .compile(CompileConfig.builder().saverConfig(SaverConfig.builder().register(saver).build())
                                .interruptAfter("first").build());
            }
        };
    }

    private GraphSegmentExecutionRequest startRequest(GraphDefinitionBinding binding) {
        return new StartGraphSegmentRequest("wf-1", 0, new LeasedJobFence("job-1", "worker", "token-1", 1, 1),
                binding, SegmentCode.INTAKE_INFERENCE_QUALITY, 0, new EmptySegmentInput());
    }

    private GraphDefinitionBinding binding() {
        return new GraphDefinitionBinding(definition.definitionVersion(), definition.definitionHash(), definition.actionVersion());
    }

    private static SegmentBusinessCommitPlan plan() {
        return new SegmentBusinessCommitPlan(WorkflowStatus.RUNNING, SegmentCode.INTAKE_INFERENCE_QUALITY,
                ExplanationPublicationStatus.NONE, PredictionExposureStatus.NOT_AVAILABLE, null, null,
                new NoBusinessDelta(), new WorkflowEventDraft("SEGMENT", "SYSTEM", "test", null, null));
    }
}

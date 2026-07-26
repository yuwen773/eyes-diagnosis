package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.KeyStrategy;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.file.FileSystemSaver;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinitionFactory;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionManifest;
import com.csust.eyediagnosis.workflow.graph.definition.GraphEdgeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphNodeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphSegmentSpec;
import com.csust.eyediagnosis.workflow.graph.definition.Sha256GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.registry.InMemoryGraphDefinitionRegistry;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;

class GraphSegmentCheckpointFileSystemTest {
    @Test
    void resumesWithNewSaverAndCompiledGraphWithoutRepeatingThePrefix(@TempDir Path directory) throws Exception {
        AtomicInteger inference = new AtomicInteger();
        AtomicInteger evidence = new AtomicInteger();
        DiagnosisGraphDefinition definition = definition();
        GraphDefinitionBinding binding = new GraphDefinitionBinding(definition.definitionVersion(), definition.definitionHash(), definition.actionVersion());
        InMemoryGraphDefinitionRegistry manifests = new InMemoryGraphDefinitionRegistry(List.of(definition), new Sha256GraphDefinitionHasher());
        ExecutableDiagnosisGraphDefinition executable = executable(binding, inference, evidence);

        DefaultGraphSegmentRuntimeAdapter first = adapter(manifests, executable, () -> FileSystemSaver.builder().targetFolder(directory).build());
        SegmentExecutionResult interrupted = first.execute(new StartGraphSegmentRequest("workflow", 0,
                new LeasedJobFence("job-start", "worker", "token", 1, 1), binding,
                SegmentCode.INTAKE_INFERENCE_QUALITY, 0, new EmptySegmentInput()));

        DefaultGraphSegmentRuntimeAdapter second = adapter(manifests, executable, () -> FileSystemSaver.builder().targetFolder(directory).build());
        SegmentExecutionResult completed = second.execute(new ResumeGraphSegmentRequest("workflow", 1,
                new LeasedJobFence("job-resume", "worker", "token-2", 1, 1), binding,
                SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, 0, interrupted.recoveryToken(), new EmptySegmentInput()));

        assertEquals(GraphRuntimeDisposition.INTERRUPTED, interrupted.disposition());
        assertEquals(GraphRuntimeDisposition.COMPLETED, completed.disposition());
        assertEquals(1, inference.get());
        assertEquals(1, evidence.get());
    }

    private static DefaultGraphSegmentRuntimeAdapter adapter(InMemoryGraphDefinitionRegistry manifests,
                                                              ExecutableDiagnosisGraphDefinition executable,
                                                              GraphCheckpointSaverFactory saverFactory) {
        return new DefaultGraphSegmentRuntimeAdapter(manifests,
                new InMemoryExecutableGraphDefinitionRegistry(manifests, List.of(executable)), saverFactory,
                new ManifestGraphSegmentBoundaryResolver());
    }

    private static DiagnosisGraphDefinition definition() {
        return DiagnosisGraphDefinitionFactory.create(new GraphDefinitionManifest("synthetic", "v1", "a1",
                List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("inference", "ACTION"),
                        new GraphNodeSpec("evidence", "ACTION"), new GraphNodeSpec("END", "BOUNDARY")),
                List.of(new GraphEdgeSpec("START", "inference"), new GraphEdgeSpec("inference", "evidence"),
                        new GraphEdgeSpec("evidence", "END")), List.of(),
                List.of(new GraphSegmentSpec(SegmentCode.INTAKE_INFERENCE_QUALITY, "START", "inference"),
                        new GraphSegmentSpec(SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, "evidence", "END")),
                List.of(), List.of("inference")), new Sha256GraphDefinitionHasher());
    }

    private static ExecutableDiagnosisGraphDefinition executable(GraphDefinitionBinding binding, AtomicInteger inference, AtomicInteger evidence) {
        return new ExecutableDiagnosisGraphDefinition() {
            @Override public GraphDefinitionBinding binding() { return binding; }
            @Override public CompiledGraph compile(BaseCheckpointSaver saver) throws Exception {
                return new StateGraph(KeyStrategy.builder().addStrategy(DefaultGraphSegmentRuntimeAdapter.BUSINESS_COMMIT_PLAN_KEY).build())
                        .addNode("inference", state -> { inference.incrementAndGet(); return CompletableFuture.completedFuture(Map.of(DefaultGraphSegmentRuntimeAdapter.BUSINESS_COMMIT_PLAN_KEY, plan())); })
                        .addNode("evidence", state -> { evidence.incrementAndGet(); return CompletableFuture.completedFuture(Map.of()); })
                        .addEdge(StateGraph.START, "inference").addEdge("inference", "evidence").addEdge("evidence", StateGraph.END)
                        .compile(CompileConfig.builder().saverConfig(SaverConfig.builder().register(saver).build()).interruptAfter("inference").build());
            }
        };
    }

    private static SegmentBusinessCommitPlan plan() {
        return new SegmentBusinessCommitPlan(WorkflowStatus.RUNNING, SegmentCode.INTAKE_INFERENCE_QUALITY,
                ExplanationPublicationStatus.NONE, PredictionExposureStatus.NOT_AVAILABLE, null, null,
                new NoBusinessDelta(), new WorkflowEventDraft("SEGMENT", "SYSTEM", "test", null, null));
    }
}

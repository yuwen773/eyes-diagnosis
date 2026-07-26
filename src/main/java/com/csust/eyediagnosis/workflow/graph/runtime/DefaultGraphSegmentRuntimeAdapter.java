package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.state.StateSnapshot;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.registry.GraphDefinitionRegistry;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

@Component
public class DefaultGraphSegmentRuntimeAdapter implements GraphSegmentRuntimeAdapter {
    public static final String BUSINESS_COMMIT_PLAN_KEY = "workflow.segment.businessCommitPlan";

    private final GraphDefinitionRegistry manifestRegistry;
    private final ExecutableGraphDefinitionRegistry executableRegistry;
    private final GraphCheckpointSaverFactory saverFactory;
    private final GraphSegmentBoundaryResolver boundaryResolver;

    public DefaultGraphSegmentRuntimeAdapter(GraphDefinitionRegistry manifestRegistry,
                                             ExecutableGraphDefinitionRegistry executableRegistry,
                                             GraphCheckpointSaverFactory saverFactory,
                                             GraphSegmentBoundaryResolver boundaryResolver) {
        this.manifestRegistry = manifestRegistry;
        this.executableRegistry = executableRegistry;
        this.saverFactory = saverFactory;
        this.boundaryResolver = boundaryResolver;
    }

    @Override
    public SegmentExecutionResult execute(GraphSegmentExecutionRequest request) {
        GraphDefinitionBinding binding = request.graphBinding();
        DiagnosisGraphDefinition manifest = manifestRegistry.requireExecutableDefinition(binding);
        CompiledGraph graph;
        try {
            graph = executableRegistry.requireExact(binding).compile(saverFactory.createForExecution());
        } catch (Exception exception) {
            throw new GraphRuntimeExecutionException("Graph compilation failed", exception);
        }
        RunnableConfig config = createConfig(request);
        try {
            graph.invokeAndGetOutput(Map.copyOf(request.input().toGraphState()), config);
            RunnableConfig latestThreadState = RunnableConfig.builder()
                    .threadId(config.threadId().orElseThrow(() -> new InvalidGraphSnapshotException("Graph config has no thread id")))
                    .build();
            return toResult(request, manifest, graph.getState(latestThreadState));
        } catch (GraphRuntimeExecutionException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new GraphRuntimeExecutionException("Graph execution failed", exception);
        } catch (Exception exception) {
            throw new GraphRuntimeExecutionException("Graph execution failed", exception);
        }
    }

    private static RunnableConfig createConfig(GraphSegmentExecutionRequest request) {
        if (request instanceof ResumeGraphSegmentRequest resume) {
            return RunnableConfig.builder().threadId(resume.recoveryToken().threadId())
                    .checkPointId(resume.recoveryToken().checkpointId()).build().withResume();
        }
        return RunnableConfig.builder().threadId(UUID.randomUUID().toString()).build();
    }

    private SegmentExecutionResult toResult(GraphSegmentExecutionRequest request, DiagnosisGraphDefinition definition,
                                            StateSnapshot snapshot) {
        if (snapshot == null || snapshot.next() == null || snapshot.next().isBlank()) {
            throw new InvalidGraphSnapshotException("Graph state snapshot has no next node");
        }
        SegmentBusinessCommitPlan plan = decodeCommitPlan(snapshot.state().data().get(BUSINESS_COMMIT_PLAN_KEY));
        String next = snapshot.next();
        if (StateGraph.END.equals(next)) {
            return new SegmentExecutionResult(request.workflowId(), request.segmentCode(), GraphRuntimeDisposition.COMPLETED,
                    next, null, null, request.graphBinding(), plan);
        }
        RunnableConfig config = snapshot.config();
        GraphRecoveryToken token = new GraphRecoveryToken(config.threadId().orElseThrow(() ->
                new InvalidGraphSnapshotException("Graph state snapshot has no thread id")), config.checkPointId().orElseThrow(() ->
                new InvalidGraphSnapshotException("Graph state snapshot has no checkpoint id")));
        SegmentCode nextSegment = boundaryResolver.resolveNextSegment(definition, next).orElseThrow(() ->
                new InvalidGraphSnapshotException("Non-terminal graph state resolved to no segment"));
        return new SegmentExecutionResult(request.workflowId(), request.segmentCode(), GraphRuntimeDisposition.INTERRUPTED,
                next, nextSegment, token, request.graphBinding(), plan);
    }

    @SuppressWarnings("unchecked")
    private static SegmentBusinessCommitPlan decodeCommitPlan(Object raw) {
        if (raw instanceof SegmentBusinessCommitPlan plan) {
            return plan;
        }
        if (!(raw instanceof Map<?, ?> rawMap)) {
            throw new InvalidGraphSnapshotException("Graph state snapshot has no business commit plan");
        }
        try {
            Map<String, Object> map = (Map<String, Object>) rawMap;
            Object rawDelta = map.get("businessDelta");
            if (!(rawDelta instanceof NoBusinessDelta)) {
                throw new InvalidGraphSnapshotException("Unsupported graph business delta state");
            }
            WorkflowEventDraft event = decodeEvent(map.get("event"));
            return new SegmentBusinessCommitPlan(
                    WorkflowStatus.valueOf((String) map.get("targetWorkflowStatus")),
                    SegmentCode.valueOf((String) map.get("persistedCurrentSegment")),
                    ExplanationPublicationStatus.valueOf((String) map.get("publicationStatus")),
                    PredictionExposureStatus.valueOf((String) map.get("exposureStatus")),
                    (String) map.get("stopReasonCode"), (String) map.get("limitationReasonCode"), new NoBusinessDelta(), event);
        } catch (ClassCastException | IllegalArgumentException | NullPointerException exception) {
            throw new InvalidGraphSnapshotException("Invalid graph business commit plan state");
        }
    }

    @SuppressWarnings("unchecked")
    private static WorkflowEventDraft decodeEvent(Object raw) {
        if (raw instanceof WorkflowEventDraft draft) {
            return draft;
        }
        if (!(raw instanceof Map<?, ?> rawMap)) {
            throw new InvalidGraphSnapshotException("Graph state snapshot has no event draft");
        }
        Map<String, Object> event = (Map<String, Object>) rawMap;
        return new WorkflowEventDraft((String) event.get("eventType"), (String) event.get("actorType"),
                (String) event.get("actorId"), (String) event.get("reasonCode"), (String) event.get("payloadSnapshot"));
    }
}

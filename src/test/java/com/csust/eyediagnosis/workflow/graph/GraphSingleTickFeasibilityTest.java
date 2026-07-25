package com.csust.eyediagnosis.workflow.graph;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.GraphRepresentation;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPIKE-G01 public seam: captures the public nextNode and interrupt contract
 * without a checkpoint or internal API.
 */
class GraphSingleTickFeasibilityTest {

    @Test
    void nextNodeDoesNotResumeAtTheScheduledNodeOrPublishTheNextNode() throws Exception {
        AtomicInteger qualityRuns = new AtomicInteger();
        AtomicInteger visionRuns = new AtomicInteger();
        AtomicInteger preludeRuns = new AtomicInteger();
        List<String> selectedRoutes = new CopyOnWriteArrayList<>();

        StateGraph graph = new StateGraph()
                .addNode("prelude", state -> {
                    preludeRuns.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("imageQuality", state -> {
                    qualityRuns.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("visionDiagnosis", state -> {
                    visionRuns.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addEdge(StateGraph.START, "prelude")
                .addEdge("prelude", "imageQuality")
                .addConditionalEdges("imageQuality", state -> {
                    selectedRoutes.add("PASS");
                    return java.util.concurrent.CompletableFuture.completedFuture("PASS");
                }, Map.of("PASS", "visionDiagnosis"))
                .addEdge("visionDiagnosis", StateGraph.END);

        CompiledGraph compiled = graph.compile(CompileConfig.builder()
                .interruptAfter("imageQuality")
                .build());
        RunnableConfig config = RunnableConfig.builder()
                .nextNode("imageQuality")
                .build();

        assertTrue(graph.getGraph(GraphRepresentation.Type.MERMAID).content().contains("imageQuality"));
        compiled.invokeAndGetOutput(Map.of(), config);

        // nextNode is not a public resume-from-node command: execution starts
        // from START and therefore runs the prelude before imageQuality.
        assertEquals(1, preludeRuns.get());
        assertEquals(1, qualityRuns.get());
        assertEquals(0, visionRuns.get());
        assertEquals(List.of("PASS"), selectedRoutes);
        assertTrue(config.nextNode().isPresent());
        // Graph Core evaluates the PASS edge but leaves the public config at the
        // input node. The only edge-inspection API returns an internal type, so
        // a DB worker cannot obtain the computed next node under SPIKE-G01 rules.
        assertEquals("imageQuality", config.nextNode().orElseThrow());
    }
}

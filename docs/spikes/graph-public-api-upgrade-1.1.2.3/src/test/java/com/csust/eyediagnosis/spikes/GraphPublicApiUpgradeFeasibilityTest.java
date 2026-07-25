package com.csust.eyediagnosis.spikes;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPIKE-G02 public seam: captures the candidate's public nextNode and
 * interrupt contract without checkpoints or internal APIs.
 */
class GraphPublicApiUpgradeFeasibilityTest {

    @Test
    void candidateRetainsTheG01SchedulingAndSuccessorLimitations() throws Exception {
        AtomicInteger preludeRuns = new AtomicInteger();
        AtomicInteger qualityRuns = new AtomicInteger();
        AtomicInteger visionRuns = new AtomicInteger();
        List<String> routes = new CopyOnWriteArrayList<>();

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
                    routes.add("PASS");
                    return java.util.concurrent.CompletableFuture.completedFuture("PASS");
                }, Map.of("PASS", "visionDiagnosis"))
                .addEdge("visionDiagnosis", StateGraph.END);

        CompiledGraph compiled = graph.compile(CompileConfig.builder()
                .interruptAfter("imageQuality")
                .build());
        RunnableConfig config = RunnableConfig.builder()
                .nextNode("imageQuality")
                .build();

        compiled.invokeAndGetOutput(Map.of(), config);

        assertEquals(1, preludeRuns.get());
        assertEquals(1, qualityRuns.get());
        assertEquals(0, visionRuns.get());
        assertEquals(List.of("PASS"), routes);
        assertEquals("imageQuality", config.nextNode().orElseThrow());
    }
}

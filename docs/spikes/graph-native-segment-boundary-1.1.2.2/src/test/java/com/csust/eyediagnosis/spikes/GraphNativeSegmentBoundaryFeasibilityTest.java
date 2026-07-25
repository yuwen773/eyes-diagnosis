package com.csust.eyediagnosis.spikes;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import com.alibaba.cloud.ai.graph.checkpoint.savers.file.FileSystemSaver;
import com.alibaba.cloud.ai.graph.checkpoint.savers.mysql.CreateOption;
import com.alibaba.cloud.ai.graph.checkpoint.savers.mysql.MysqlSaver;
import com.mysql.cj.jdbc.MysqlDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * SPIKE-G03 public seam: a completed Graph segment resumes through public
 * checkpoint APIs without repeating its image-inference side effect.
 */
class GraphNativeSegmentBoundaryFeasibilityTest {

    @Test
    void passSegmentRestartsFromThePublicBoundaryWithoutRepeatingInference(@TempDir Path checkpointDirectory)
            throws Exception {
        AtomicInteger diagnoseRpcCalls = new AtomicInteger();
        AtomicInteger qualityRouteCalls = new AtomicInteger();
        AtomicInteger visionExposureCalls = new AtomicInteger();
        AtomicInteger riskPrecheckCalls = new AtomicInteger();
        AtomicInteger evidenceRetrievalCalls = new AtomicInteger();

        StateGraph graph = new StateGraph()
                .addNode("imageInference", state -> {
                    diagnoseRpcCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("qualityRoute", state -> {
                    qualityRouteCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("visionExposure", state -> {
                    visionExposureCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("riskPrecheck", state -> {
                    riskPrecheckCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("evidenceRetrieval", state -> {
                    evidenceRetrievalCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addEdge(StateGraph.START, "imageInference")
                .addEdge("imageInference", "qualityRoute")
                .addConditionalEdges("qualityRoute", state ->
                        java.util.concurrent.CompletableFuture.completedFuture("PASS"),
                        Map.of("PASS", "visionExposure"))
                .addEdge("visionExposure", "riskPrecheck")
                .addEdge("riskPrecheck", "evidenceRetrieval")
                .addEdge("evidenceRetrieval", StateGraph.END);

        FileSystemSaver initialSaver = FileSystemSaver.builder()
                .targetFolder(checkpointDirectory)
                .build();
        CompiledGraph compiled = graph.compile(CompileConfig.builder()
                .saverConfig(SaverConfig.builder().register(initialSaver).build())
                .interruptAfter("riskPrecheck")
                .build());
        RunnableConfig config = RunnableConfig.builder()
                .threadId("pass-segment")
                .build();

        compiled.invokeAndGetOutput(Map.of(), config);

        assertEquals(1, diagnoseRpcCalls.get());
        assertEquals(1, qualityRouteCalls.get());
        assertEquals(1, visionExposureCalls.get());
        assertEquals(1, riskPrecheckCalls.get());
        assertEquals(0, evidenceRetrievalCalls.get());
        assertEquals("evidenceRetrieval", compiled.getState(config).next());

        FileSystemSaver restartedSaver = FileSystemSaver.builder()
                .targetFolder(checkpointDirectory)
                .build();
        CompiledGraph restartedGraph = graph.compile(CompileConfig.builder()
                .saverConfig(SaverConfig.builder().register(restartedSaver).build())
                .interruptAfter("riskPrecheck")
                .build());
        restartedGraph.invokeAndGetOutput(Map.of(), compiled.getState(config).config().withResume());

        assertEquals(1, diagnoseRpcCalls.get());
        assertEquals(1, qualityRouteCalls.get());
        assertEquals(1, visionExposureCalls.get());
        assertEquals(1, riskPrecheckCalls.get());
        assertEquals(1, evidenceRetrievalCalls.get());
    }

    @Test
    void reviewInterruptResumesThroughThePublicContractWithoutRepeatingInference() throws Exception {
        AtomicInteger diagnoseRpcCalls = new AtomicInteger();
        AtomicInteger humanReviewCalls = new AtomicInteger();
        AtomicInteger visionExposureCalls = new AtomicInteger();

        StateGraph graph = new StateGraph()
                .addNode("imageInference", state -> {
                    diagnoseRpcCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("qualityRoute", state -> java.util.concurrent.CompletableFuture.completedFuture(Map.of()))
                .addNode("humanReview", state -> {
                    humanReviewCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("visionExposure", state -> {
                    visionExposureCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addEdge(StateGraph.START, "imageInference")
                .addEdge("imageInference", "qualityRoute")
                .addConditionalEdges("qualityRoute", state ->
                        java.util.concurrent.CompletableFuture.completedFuture("REVIEW"),
                        Map.of("REVIEW", "humanReview"))
                .addConditionalEdges("humanReview", state ->
                        java.util.concurrent.CompletableFuture.completedFuture(
                                state.value("reviewDecision", String.class).orElseThrow()),
                        Map.of("APPROVE_CONTINUE", "visionExposure"))
                .addEdge("visionExposure", StateGraph.END);

        MemorySaver saver = new MemorySaver();
        CompiledGraph compiled = graph.compile(CompileConfig.builder()
                .saverConfig(SaverConfig.builder().register(saver).build())
                .interruptBefore("humanReview")
                .build());
        RunnableConfig config = RunnableConfig.builder()
                .threadId("review-segment")
                .build();

        compiled.invokeAndGetOutput(Map.of(), config);

        assertEquals(1, diagnoseRpcCalls.get());
        assertEquals(0, humanReviewCalls.get());
        assertEquals(0, visionExposureCalls.get());
        assertEquals("humanReview", compiled.getState(config).next());

        compiled.invokeAndGetOutput(Map.of("reviewDecision", "APPROVE_CONTINUE"),
                compiled.getState(config).config().withResume());

        assertEquals(1, diagnoseRpcCalls.get());
        assertEquals(1, humanReviewCalls.get());
        assertEquals(1, visionExposureCalls.get());
    }

    @Test
    void rejectRouteEndsWithoutExecutingTheSuccessor() throws Exception {
        AtomicInteger imageInferenceCalls = new AtomicInteger();
        AtomicInteger evidenceRetrievalCalls = new AtomicInteger();

        StateGraph graph = new StateGraph()
                .addNode("imageInference", state -> {
                    imageInferenceCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("qualityRoute", state -> java.util.concurrent.CompletableFuture.completedFuture(Map.of()))
                .addNode("evidenceRetrieval", state -> {
                    evidenceRetrievalCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addEdge(StateGraph.START, "imageInference")
                .addEdge("imageInference", "qualityRoute")
                .addConditionalEdges("qualityRoute", state ->
                        java.util.concurrent.CompletableFuture.completedFuture("REJECT"),
                        Map.of("REJECT", StateGraph.END))
                .addEdge("evidenceRetrieval", StateGraph.END);

        MemorySaver saver = new MemorySaver();
        CompiledGraph compiled = graph.compile(CompileConfig.builder()
                .saverConfig(SaverConfig.builder().register(saver).build())
                .build());
        RunnableConfig config = RunnableConfig.builder()
                .threadId("reject-segment")
                .build();

        compiled.invokeAndGetOutput(Map.of(), config);

        assertEquals(1, imageInferenceCalls.get());
        assertEquals(0, evidenceRetrievalCalls.get());
        assertEquals(StateGraph.END, compiled.getState(config).next());
    }

    @Test
    void mysqlCheckpointRestoresTheSegmentWithThePublicSnapshotToken() throws Exception {
        assumeTrue(mysqlEnvironmentIsConfigured(),
                "G03_MYSQL_URL, G03_MYSQL_USERNAME, and G03_MYSQL_PASSWORD are required");
        AtomicInteger diagnoseRpcCalls = new AtomicInteger();
        AtomicInteger riskPrecheckCalls = new AtomicInteger();
        AtomicInteger evidenceRetrievalCalls = new AtomicInteger();

        StateGraph graph = new StateGraph()
                .addNode("imageInference", state -> {
                    diagnoseRpcCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("riskPrecheck", state -> {
                    riskPrecheckCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addNode("evidenceRetrieval", state -> {
                    evidenceRetrievalCalls.incrementAndGet();
                    return java.util.concurrent.CompletableFuture.completedFuture(Map.of());
                })
                .addEdge(StateGraph.START, "imageInference")
                .addEdge("imageInference", "riskPrecheck")
                .addEdge("riskPrecheck", "evidenceRetrieval")
                .addEdge("evidenceRetrieval", StateGraph.END);

        RunnableConfig config = RunnableConfig.builder()
                .threadId("mysql-restart-segment")
                .build();
        CompiledGraph initialGraph = graph.compile(CompileConfig.builder()
                .saverConfig(SaverConfig.builder().register(mysqlSaver()).build())
                .interruptAfter("riskPrecheck")
                .build());

        initialGraph.invokeAndGetOutput(Map.of(), config);

        assertEquals(1, diagnoseRpcCalls.get());
        assertEquals(1, riskPrecheckCalls.get());
        assertEquals(0, evidenceRetrievalCalls.get());

        var snapshot = initialGraph.getState(config);
        assertEquals("evidenceRetrieval", snapshot.next());
        RunnableConfig resumeConfig = snapshot.config().withResume();

        CompiledGraph restartedGraph = graph.compile(CompileConfig.builder()
                .saverConfig(SaverConfig.builder().register(mysqlSaver()).build())
                .interruptAfter("riskPrecheck")
                .build());
        restartedGraph.invokeAndGetOutput(Map.of(), resumeConfig);

        assertEquals(1, diagnoseRpcCalls.get());
        assertEquals(1, riskPrecheckCalls.get());
        assertEquals(1, evidenceRetrievalCalls.get());
    }

    private MysqlSaver mysqlSaver() {
        MysqlDataSource dataSource = new MysqlDataSource();
        dataSource.setURL(requiredEnvironment("G03_MYSQL_URL"));
        dataSource.setUser(requiredEnvironment("G03_MYSQL_USERNAME"));
        dataSource.setPassword(requiredEnvironment("G03_MYSQL_PASSWORD"));
        return MysqlSaver.builder()
                .dataSource(dataSource)
                .createOption(CreateOption.CREATE_IF_NOT_EXISTS)
                .build();
    }

    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " must be set for the MySQL checkpoint spike");
        }
        return value;
    }

    private boolean mysqlEnvironmentIsConfigured() {
        return hasEnvironment("G03_MYSQL_URL")
                && hasEnvironment("G03_MYSQL_USERNAME")
                && hasEnvironment("G03_MYSQL_PASSWORD");
    }

    private boolean hasEnvironment(String name) {
        String value = System.getenv(name);
        return value != null && !value.isBlank();
    }
}

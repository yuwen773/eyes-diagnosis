package com.csust.eyediagnosis.poc.realtime;

import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.GraphLifecycleListener;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import com.alibaba.cloud.ai.graph.serializer.check_point.CheckPointSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;
import reactor.core.scheduler.Schedulers;

import java.util.List;
import java.util.Map;
import java.io.ObjectOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Timeout(15)
class RealtimeGraphSpikeTest {
    private final ThreadPoolExecutor parallel = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(8));
    private final ExecutorService driver = Executors.newSingleThreadExecutor();
    private final AtomicInteger visionCalls = new AtomicInteger();
    private final AtomicInteger evidenceCalls = new AtomicInteger();
    private final AtomicInteger explanationCalls = new AtomicInteger();
    private final AtomicInteger criticCalls = new AtomicInteger();

    private FourRoleGraph.Roles roles(String firstFeedback) {
        return new FourRoleGraph.Roles(state -> {
            visionCalls.incrementAndGet();
            return Map.of("vision", "synthetic-vision");
        }, state -> Map.of("evidenceVersion", evidenceCalls.incrementAndGet()), state -> {
            int version = explanationCalls.incrementAndGet();
            return Map.of("draftVersion", version, "draftEvidenceVersion", state.data().get("evidenceVersion"));
        }, state -> {
            int call = criticCalls.incrementAndGet();
            return Map.of("feedback", call == 1 ? firstFeedback : "NONE",
                    "checkedDraftVersion", state.data().get("draftVersion"));
        });
    }

    @AfterEach
    void stopExecutor() throws InterruptedException {
        driver.shutdownNow();
        parallel.shutdownNow();
        assertTrue(driver.awaitTermination(5, TimeUnit.SECONDS), "Graph driver must release test resources");
        assertTrue(parallel.awaitTermination(5, TimeUnit.SECONDS), "Graph branches must release test resources");
    }

    private RunnableConfig runConfig(String threadId) {
        return RunnableConfig.builder().threadId(threadId).defaultParallelExecutor(parallel).build();
    }

    @Test
    void parallelBranchesJoinBeforeExplanationWithoutLosingState() throws Exception {
        var bothEntered = new CountDownLatch(2);
        var roles = new FourRoleGraph.Roles(state -> {
            bothEntered.countDown();
            assertTrue(bothEntered.await(2, TimeUnit.SECONDS), "Evidence must start while Vision is in flight");
            return Map.of("vision", "synthetic-vision");
        }, state -> {
            bothEntered.countDown();
            assertTrue(bothEntered.await(2, TimeUnit.SECONDS), "Vision must start while Evidence is in flight");
            return Map.of("evidenceVersion", 1);
        }, state -> {
            assertEquals("synthetic-vision", state.data().get("vision"));
            assertEquals(1, state.data().get("evidenceVersion"));
            return Map.of("draftVersion", 1);
        }, state -> Map.of("feedback", "NONE"));

        var result = FourRoleGraph.compile(roles, CompileConfig.builder().build())
                .invoke(Map.of("inferenceDigest", "synthetic-input-a"), runConfig("parallel"))
                .orElseThrow();

        assertEquals("synthetic-vision", result.data().get("vision"));
        assertEquals(1, result.data().get("evidenceVersion"));
        assertEquals(1, result.data().get("draftVersion"));
        assertEquals("NONE", result.data().get("feedback"));
        assertEquals("synthetic-input-a", result.data().get("inferenceDigest"));
    }

    @Test
    void rewriteRechecksNewDraftWithoutRerunningVisionOrEvidence() throws Exception {
        var result = FourRoleGraph.compile(roles("REWRITE"), CompileConfig.builder().build())
                .invoke(Map.of(), runConfig("rewrite")).orElseThrow();

        assertEquals(2, result.data().get("draftVersion"));
        assertEquals(2, result.data().get("checkedDraftVersion"));
        assertEquals(1, result.data().get("draftEvidenceVersion"));
        assertEquals("NONE", result.data().get("feedback"));
        assertEquals(1, visionCalls.get());
        assertEquals(1, evidenceCalls.get());
        assertEquals(2, criticCalls.get());
    }

    @Test
    void supplementRechecksDraftAgainstNewEvidenceWithoutRerunningVision() throws Exception {
        var result = FourRoleGraph.compile(roles("SUPPLEMENT"), CompileConfig.builder().build())
                .invoke(Map.of(), runConfig("supplement")).orElseThrow();

        assertEquals(2, result.data().get("evidenceVersion"));
        assertEquals(2, result.data().get("draftEvidenceVersion"));
        assertEquals(2, result.data().get("checkedDraftVersion"));
        assertEquals("NONE", result.data().get("feedback"));
        assertEquals(1, visionCalls.get());
        assertEquals(2, evidenceCalls.get());
        assertEquals(2, criticCalls.get());
    }

    @Test
    void applicationFeedbackBudgetStopsRepeatedRewrite() throws Exception {
        var base = roles("REWRITE");
        var repeating = new FourRoleGraph.Roles(base.vision(), base.evidence(), base.explanation(), state -> {
            criticCalls.incrementAndGet();
            return Map.of("feedback", "REWRITE");
        });
        var graph = FourRoleGraph.compile(repeating, CompileConfig.builder().recursionLimit(12).build());

        var failure = assertThrows(RuntimeException.class, () -> graph.invoke(Map.of(), runConfig("bounded")));
        assertTrue(failure.toString().contains("FEEDBACK_LIMIT"), failure::toString);
        assertEquals(2, explanationCalls.get());
        assertEquals(2, criticCalls.get());
    }

    @Test
    void nodeStreamEmitsExplanationWhileCriticIsStillInFlight() throws Exception {
        var base = roles("NONE");
        var criticEntered = new CountDownLatch(1);
        var releaseCritic = new CountDownLatch(1);
        var blocked = new FourRoleGraph.Roles(base.vision(), base.evidence(), base.explanation(), state -> {
            criticEntered.countDown();
            assertTrue(releaseCritic.await(5, TimeUnit.SECONDS));
            return base.critic().apply(state);
        });
        var observed = new CopyOnWriteArrayList<String>();
        var pending = FourRoleGraph.compile(blocked, CompileConfig.builder().build())
                .stream(Map.of(), runConfig("stream"))
                .doOnNext(output -> observed.add(output.node()))
                .subscribeOn(Schedulers.fromExecutor(driver)).collectList().toFuture();
        try {
            assertTrue(criticEntered.await(5, TimeUnit.SECONDS));
            assertTrue(observed.contains("explanation"), observed::toString);
            assertFalse(observed.contains(StateGraph.END));
            assertFalse(pending.isDone(), "Node events must arrive before the whole graph finishes");
        } finally {
            releaseCritic.countDown();
        }
        var outputs = pending.get(5, TimeUnit.SECONDS);
        assertTrue(outputs.getLast().isEND());
        assertEquals("NONE", outputs.getLast().state().data().get("feedback"));
    }

    @Test
    void parallelLifecycleReportsEvidenceBeforeVisionCompletesButAfterStateIsNotTheResult() throws Exception {
        var base = roles("NONE");
        var visionEntered = new CountDownLatch(1);
        var releaseVision = new CountDownLatch(1);
        var evidenceAfter = new CountDownLatch(1);
        var afterContainsResult = new AtomicBoolean();
        var callbacks = new CopyOnWriteArrayList<String>();
        var listener = new GraphLifecycleListener() {
            @Override
            public void before(String node, Map<String, Object> state, RunnableConfig config, Long at) {
                callbacks.add("before:" + node);
            }

            @Override
            public void after(String node, Map<String, Object> state, RunnableConfig config, Long at) {
                callbacks.add("after:" + node);
                if ("evidence".equals(node)) {
                    afterContainsResult.set(state.containsKey("evidenceVersion"));
                    evidenceAfter.countDown();
                }
            }
        };
        var blocked = new FourRoleGraph.Roles(state -> {
            visionEntered.countDown();
            assertTrue(releaseVision.await(5, TimeUnit.SECONDS));
            return base.vision().apply(state);
        }, state -> {
            assertTrue(visionEntered.await(5, TimeUnit.SECONDS));
            return base.evidence().apply(state);
        }, base.explanation(), base.critic());
        var observed = new CopyOnWriteArrayList<String>();
        var pending = FourRoleGraph.compile(blocked, CompileConfig.builder().withLifecycleListener(listener).build())
                .stream(Map.of(), runConfig("branch-events"))
                .doOnNext(output -> observed.add(output.node()))
                .subscribeOn(Schedulers.fromExecutor(driver)).collectList().toFuture();
        try {
            assertTrue(evidenceAfter.await(5, TimeUnit.SECONDS));
            assertTrue(callbacks.containsAll(List.of("before:vision", "before:evidence", "after:evidence")));
            assertFalse(callbacks.contains("after:vision"));
            assertFalse(callbacks.contains("before:explanation"));
            assertFalse(observed.contains("evidence"), "Parallel branches are aggregated in NodeOutput");
            assertFalse(afterContainsResult.get(), "Parallel after callback receives pre-merge state");
            assertFalse(pending.isDone());
        } finally {
            releaseVision.countDown();
        }
        assertTrue(pending.get(5, TimeUnit.SECONDS).getLast().isEND());
        assertTrue(callbacks.containsAll(List.of("after:vision", "after:explanation", "after:critic")));
    }

    @Test
    void fourRoleCheckpointResumesInAnotherJvmWithoutRepeatingCompletedRoles(@TempDir Path directory) throws Exception {
        var saver = new MemorySaver();
        var config = runConfig("cross-jvm");
        var compile = CompileConfig.builder().releaseThread(false)
                .saverConfig(SaverConfig.builder().register(saver).build()).interruptBefore("explanation").build();
        FourRoleGraph.compile(roles("NONE"), compile)
                .invoke(Map.of("inferenceDigest", "synthetic-input-a"), config);
        var checkpoint = saver.get(config).orElseThrow();
        assertEquals("synthetic-vision", checkpoint.getState().get("vision"));
        assertEquals(1, checkpoint.getState().get("evidenceVersion"));
        assertFalse(checkpoint.getState().containsKey("draftVersion"));
        assertEquals(0, explanationCalls.get());
        var checkpointFile = directory.resolve("checkpoint.bin");
        try (var out = new ObjectOutputStream(Files.newOutputStream(checkpointFile))) {
            new CheckPointSerializer(StateGraph.DEFAULT_JACKSON_SERIALIZER).write(checkpoint, out);
        }
        var resultFile = directory.resolve("result.json");
        var childLog = directory.resolve("child.log");
        var child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java", "-cp",
                System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
                "com.csust.eyediagnosis.poc.realtime.GraphSpikeResumeWorker",
                checkpointFile.toString(), resultFile.toString())
                .redirectErrorStream(true).redirectOutput(childLog.toFile()).start();
        try {
            assertTrue(child.waitFor(10, TimeUnit.SECONDS), "Checkpoint child must finish");
            assertEquals(0, child.exitValue(), () -> {
                try { return new String(Files.readAllBytes(childLog), StandardCharsets.UTF_8); }
                catch (Exception e) { return e.toString(); }
            });
            var result = new ObjectMapper().readTree(resultFile.toFile());
            assertNotEquals(ProcessHandle.current().pid(), result.path("pid").asLong());
            assertEquals("synthetic-input-a", result.path("state").path("inferenceDigest").asText());
            assertEquals("synthetic-vision", result.path("state").path("vision").asText());
            assertEquals(1, result.path("state").path("evidenceVersion").asInt());
            assertEquals(1, result.path("state").path("draftVersion").asInt());
            assertEquals(1, result.path("state").path("draftEvidenceVersion").asInt());
            assertEquals("NONE", result.path("state").path("feedback").asText());
            assertEquals(List.of("explanation", "critic"),
                    new ObjectMapper().convertValue(result.path("calls"), List.class));
        } finally {
            if (child.isAlive()) {
                child.destroyForcibly();
                assertTrue(child.waitFor(5, TimeUnit.SECONDS));
            }
        }
    }

    @Test
    void cancellingSubscriberStopsDownstreamButDoesNotStopProviderOrLateLifecycleCallbacks() throws Exception {
        var base = roles("NONE");
        var providerEntered = new CountDownLatch(1);
        var releaseProvider = new CountDownLatch(1);
        var lateAfter = new CountDownLatch(1);
        var listener = new GraphLifecycleListener() {
            @Override
            public void after(String node, Map<String, Object> state, RunnableConfig config, Long at) {
                if ("vision".equals(node)) lateAfter.countDown();
            }
        };
        var blocked = new FourRoleGraph.Roles(state -> {
            providerEntered.countDown();
            assertTrue(releaseProvider.await(5, TimeUnit.SECONDS));
            return base.vision().apply(state);
        }, base.evidence(), base.explanation(), base.critic());
        var saver = new MemorySaver();
        var config = runConfig("cancel-subscription");
        var compile = CompileConfig.builder().releaseThread(false).withLifecycleListener(listener)
                .saverConfig(SaverConfig.builder().register(saver).build()).build();
        var pending = FourRoleGraph.compile(blocked, compile).stream(Map.of(), config)
                .subscribeOn(Schedulers.fromExecutor(driver)).collectList().toFuture();
        try {
            assertTrue(providerEntered.await(5, TimeUnit.SECONDS));
            assertTrue(pending.cancel(true));
            assertEquals(1, lateAfter.getCount(), "Provider is still waiting after subscriber cancellation");
        } finally {
            releaseProvider.countDown();
        }
        assertTrue(lateAfter.await(5, TimeUnit.SECONDS), "Late callback still occurs after the subscriber is gone");
        assertTrue(pending.isCancelled());
        assertEquals(1, visionCalls.get(), "External work completed despite cancellation");
        assertEquals(0, explanationCalls.get());
        assertEquals(0, criticCalls.get());
        assertFalse(saver.get(config).orElseThrow().getState().containsKey("draftVersion"));
    }

    @Test
    void missingFeedbackCannotBeTreatedAsSuccessfulReview() throws Exception {
        var base = roles("NONE");
        var invalid = new FourRoleGraph.Roles(base.vision(), base.evidence(), base.explanation(), state -> Map.of());
        var graph = FourRoleGraph.compile(invalid, CompileConfig.builder().build());

        var failure = assertThrows(RuntimeException.class, () -> graph.invoke(Map.of(), runConfig("invalid-feedback")));
        assertTrue(failure.toString().contains("INVALID_FEEDBACK"), failure::toString);
    }

    @Test
    void roleFailurePreventsExplanationAndCritique() throws Exception {
        var base = roles("NONE");
        var invalid = new FourRoleGraph.Roles(base.vision(), state -> {
            throw new IllegalStateException("SOURCE_INVALIDATED");
        }, base.explanation(), base.critic());
        var graph = FourRoleGraph.compile(invalid, CompileConfig.builder().build());

        var failure = assertThrows(RuntimeException.class, () -> graph.invoke(Map.of(), runConfig("role-failure")));
        assertTrue(failure.toString().contains("SOURCE_INVALIDATED"), failure::toString);
        assertEquals(0, explanationCalls.get());
        assertEquals(0, criticCalls.get());
    }

    @Test
    void lifecycleListenerExceptionDoesNotVetoExecution() throws Exception {
        var attempts = new AtomicInteger();
        var listener = new GraphLifecycleListener() {
            @Override
            public void before(String node, Map<String, Object> state, RunnableConfig config, Long at) {
                if ("explanation".equals(node)) {
                    attempts.incrementAndGet();
                    throw new IllegalStateException("Listener is not a domain gate");
                }
            }
        };
        var result = FourRoleGraph.compile(roles("NONE"),
                        CompileConfig.builder().withLifecycleListener(listener).build())
                .invoke(Map.of(), runConfig("listener-is-not-guard")).orElseThrow();

        assertEquals(1, attempts.get());
        assertEquals("NONE", result.data().get("feedback"));
        assertEquals(1, explanationCalls.get());
        assertEquals(1, criticCalls.get());
    }

    @Test
    void frameworkRecursionLimitCanCloseStreamWithoutSuccessfulEnd() throws Exception {
        var outputs = FourRoleGraph.compile(roles("NONE"), CompileConfig.builder().recursionLimit(1).build())
                .stream(Map.of(), runConfig("recursion-limit")).collectList().block(Duration.ofSeconds(5));

        assertFalse(outputs.isEmpty());
        assertFalse(outputs.stream().anyMatch(output -> output.isEND()));
        assertFalse(outputs.getLast().state().data().containsKey("feedback"));
        assertEquals(0, criticCalls.get(), "Stream completion alone is not a successful review");
    }
}

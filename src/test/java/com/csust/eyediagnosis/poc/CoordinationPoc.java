package com.csust.eyediagnosis.poc;

import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import com.alibaba.cloud.ai.graph.serializer.check_point.CheckPointSerializer;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.util.Map;

import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;

/** Isolated experiment, not a clinical workflow or production scheduler. */
final class CoordinationPoc {
    enum Engine { DOMAIN, GRAPH }
    record PreparedGraph(String status, byte[] checkpoint) { }

    static String advance(Engine engine, String state) throws Exception {
        if (!"READY".equals(state)) {
            throw new IllegalArgumentException("Unsupported state: " + state);
        }
        if (engine == Engine.DOMAIN) {
            return "WAITING_REVIEW";
        }
        return prepareGraph().status();
    }

    static String resumeSerializedGraph() throws Exception {
        return resumeCheckpoint(interruptedCheckpoint());
    }

    static byte[] interruptedCheckpoint() throws Exception {
        return prepareGraph().checkpoint();
    }

    static PreparedGraph prepareGraph() throws Exception {
        var saver = new MemorySaver();
        var config = RunnableConfig.builder().threadId("poc").build();
        var graph = interruptibleGraph(saver);
        graph.invoke(Map.of("status", "READY"), config);
        var checkpoint = saver.get(config).orElseThrow();
        var serializer = new CheckPointSerializer(StateGraph.DEFAULT_JACKSON_SERIALIZER);
        var bytes = new ByteArrayOutputStream();
        try (var out = new ObjectOutputStream(bytes)) { serializer.write(checkpoint, out); }
        return new PreparedGraph((String) checkpoint.getState().get("status"), bytes.toByteArray());
    }

    static String resumeCheckpoint(byte[] bytes) throws Exception {
        var config = RunnableConfig.builder().threadId("poc").build();
        var serializer = new CheckPointSerializer(StateGraph.DEFAULT_JACKSON_SERIALIZER);
        var restored = new MemorySaver();
        try (var in = new ObjectInputStream(new ByteArrayInputStream(bytes))) {
            restored.put(config, serializer.read(in));
        }
        return (String) interruptibleGraph(restored).invoke(Map.of(), config.withResume()).orElseThrow().data().get("status");
    }

    private static com.alibaba.cloud.ai.graph.CompiledGraph interruptibleGraph(MemorySaver saver) throws Exception {
        StateGraph graph = new StateGraph();
        graph.addNode("prepare", node_async(s -> Map.of("status", "WAITING_REVIEW")));
        graph.addNode("review", node_async(s -> Map.of("status", "WAITING_REVIEW")));
        graph.addEdge(StateGraph.START, "prepare");
        graph.addEdge("prepare", "review");
        graph.addEdge("review", StateGraph.END);
        return graph.compile(CompileConfig.builder().saverConfig(SaverConfig.builder().register(saver).build())
                .interruptBefore("review").build());
    }
}

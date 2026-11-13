package com.csust.eyediagnosis.poc.realtime;

import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.action.NodeAction;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import com.alibaba.cloud.ai.graph.serializer.check_point.CheckPointSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.ObjectInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Map;

/** Separate-JVM recovery of a trusted, synthetic test checkpoint; never an application entry point. */
public final class GraphSpikeResumeWorker {
    public static void main(String[] args) throws Exception {
        var saver = new MemorySaver();
        var config = RunnableConfig.builder().threadId("cross-jvm").build();
        try (var in = new ObjectInputStream(Files.newInputStream(Path.of(args[0])))) {
            saver.put(config, new CheckPointSerializer(StateGraph.DEFAULT_JACKSON_SERIALIZER).read(in));
        }
        NodeAction committedRole = state -> { throw new IllegalStateException("Committed role was repeated"); };
        var calls = new ArrayList<String>();
        var roles = new FourRoleGraph.Roles(committedRole, committedRole, state -> {
            calls.add("explanation");
            return Map.of("draftVersion", 1, "draftEvidenceVersion", state.data().get("evidenceVersion"));
        }, state -> {
            calls.add("critic");
            return Map.of("feedback", "NONE");
        });
        var compile = CompileConfig.builder().releaseThread(false)
                .saverConfig(SaverConfig.builder().register(saver).build()).build();
        var result = FourRoleGraph.compile(roles, compile).invoke(Map.of(), config.withResume()).orElseThrow();
        new ObjectMapper().writeValue(Path.of(args[1]).toFile(),
                Map.of("pid", ProcessHandle.current().pid(), "state", result.data(), "calls", calls));
    }
}

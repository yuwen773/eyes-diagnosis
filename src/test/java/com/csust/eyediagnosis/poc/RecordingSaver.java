package com.csust.eyediagnosis.poc;

import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.Checkpoint;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import com.alibaba.cloud.ai.graph.serializer.check_point.CheckPointSerializer;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** Stages every framework write in memory; callers must commit the staged writes with business state. */
final class RecordingSaver implements BaseCheckpointSaver {
    record Write(String selectedId, byte[] payload) { }
    private final MemorySaver delegate = new MemorySaver();
    private final List<Write> writes = new ArrayList<>();
    private final List<String> calls = new ArrayList<>();
    private final CheckPointSerializer serializer = new CheckPointSerializer(StateGraph.DEFAULT_JACKSON_SERIALIZER);

    List<Write> writes() { return List.copyOf(writes); }
    List<String> calls() { return List.copyOf(calls); }

    void restore(String threadId, List<Write> saved) throws Exception {
        for (var write : saved) {
            var builder = RunnableConfig.builder().threadId(threadId);
            if (write.selectedId() != null) builder.checkPointId(write.selectedId());
            try (var input = new ObjectInputStream(new ByteArrayInputStream(write.payload()))) {
                delegate.put(builder.build(), serializer.read(input));
            }
        }
    }

    @Override public Collection<Checkpoint> list(RunnableConfig config) {
        calls.add("list"); return delegate.list(config);
    }
    @Override public Optional<Checkpoint> get(RunnableConfig config) {
        calls.add("get"); return delegate.get(config);
    }
    @Override public RunnableConfig put(RunnableConfig config, Checkpoint checkpoint) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var output = new ObjectOutputStream(bytes)) { serializer.write(checkpoint, output); }
        var result = delegate.put(config, checkpoint);
        writes.add(new Write(config.checkPointId().orElse(null), bytes.toByteArray()));
        calls.add("put:" + checkpoint.getNodeId() + "->" + checkpoint.getNextNodeId());
        return result;
    }
    @Override public Tag release(RunnableConfig config) {
        calls.add("release");
        throw new UnsupportedOperationException("PoC does not support transactional release");
    }
}

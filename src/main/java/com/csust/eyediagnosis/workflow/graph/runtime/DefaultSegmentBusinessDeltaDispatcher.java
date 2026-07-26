package com.csust.eyediagnosis.workflow.graph.runtime;

import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class DefaultSegmentBusinessDeltaDispatcher implements SegmentBusinessDeltaDispatcher {
    private final List<SegmentBusinessDeltaWriter<? extends SegmentBusinessDelta>> writers;

    public DefaultSegmentBusinessDeltaDispatcher(List<SegmentBusinessDeltaWriter<? extends SegmentBusinessDelta>> writers) {
        this.writers = List.copyOf(writers);
    }

    @Override
    public void persist(SegmentBusinessDelta delta) {
        if (delta instanceof NoBusinessDelta) {
            return;
        }
        SegmentBusinessDeltaWriter<?> writer = writers.stream()
                .filter(candidate -> candidate.supportedType().equals(delta.getClass()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No business delta writer for " + delta.getClass().getName()));
        write(writer, delta);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static void write(SegmentBusinessDeltaWriter writer, SegmentBusinessDelta delta) {
        writer.write(delta);
    }
}

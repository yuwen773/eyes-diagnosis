package com.csust.eyediagnosis.workflow.graph.definition;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;

@Component
public class Sha256GraphDefinitionHasher implements GraphDefinitionHasher {
    @Override
    public String hash(GraphDefinitionManifest manifest) {
        StringBuilder canonical = new StringBuilder();
        line(canonical, "graphId", manifest.graphId());
        line(canonical, "definitionVersion", manifest.definitionVersion());
        line(canonical, "actionVersion", manifest.actionVersion());
        manifest.nodes().stream().sorted(Comparator.comparing(GraphNodeSpec::nodeCode)).forEach(node -> line(canonical, "node", node.nodeCode(), node.nodeType()));
        manifest.edges().stream().sorted(Comparator.comparing(GraphEdgeSpec::sourceNodeCode).thenComparing(GraphEdgeSpec::targetNodeCode)).forEach(edge -> line(canonical, "edge", edge.sourceNodeCode(), edge.targetNodeCode()));
        manifest.conditionalEdges().stream().sorted(Comparator.comparing(GraphConditionalEdgeSpec::sourceNodeCode).thenComparing(GraphConditionalEdgeSpec::conditionCode).thenComparing(GraphConditionalEdgeSpec::targetNodeCode)).forEach(edge -> line(canonical, "conditionalEdge", edge.sourceNodeCode(), edge.conditionCode(), edge.targetNodeCode()));
        manifest.segments().stream().sorted(Comparator.comparing(segment -> segment.segmentCode().name())).forEach(segment -> line(canonical, "segment", segment.segmentCode().name(), segment.entryBoundary(), segment.exitBoundary()));
        manifest.interruptBeforeNodes().stream().sorted().forEach(node -> line(canonical, "interruptBefore", node));
        manifest.interruptAfterNodes().stream().sorted().forEach(node -> line(canonical, "interruptAfter", node));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte value : digest) hex.append(String.format("%02x", value));
            return hex.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static void line(StringBuilder canonical, String label, String... values) {
        canonical.append(label);
        for (String value : values) canonical.append('\t').append(value);
        canonical.append('\n');
    }
}

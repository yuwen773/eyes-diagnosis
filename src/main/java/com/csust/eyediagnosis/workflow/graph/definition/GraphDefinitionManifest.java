package com.csust.eyediagnosis.workflow.graph.definition;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/** Immutable, declarative topology for a diagnosis graph; it contains no runtime routing logic. */
public record GraphDefinitionManifest(
        String graphId,
        String definitionVersion,
        String actionVersion,
        List<GraphNodeSpec> nodes,
        List<GraphEdgeSpec> edges,
        List<GraphConditionalEdgeSpec> conditionalEdges,
        List<GraphSegmentSpec> segments,
        List<String> interruptBeforeNodes,
        List<String> interruptAfterNodes
) {
    public GraphDefinitionManifest {
        nodes = List.copyOf(nodes);
        edges = List.copyOf(edges);
        conditionalEdges = List.copyOf(conditionalEdges);
        segments = List.copyOf(segments);
        interruptBeforeNodes = List.copyOf(interruptBeforeNodes);
        interruptAfterNodes = List.copyOf(interruptAfterNodes);
        requireText(graphId, "graphId");
        requireText(definitionVersion, "definitionVersion");
        requireText(actionVersion, "actionVersion");

        Set<String> nodeCodes = nodes.stream().peek(Objects::requireNonNull).map(GraphNodeSpec::nodeCode).collect(Collectors.toSet());
        if (nodeCodes.size() != nodes.size()) throw new IllegalArgumentException("Graph node codes must be unique");
        nodes.forEach(node -> { requireText(node.nodeCode(), "nodeCode"); requireText(node.nodeType(), "nodeType"); });
        if (!nodeCodes.contains("START") || !nodeCodes.contains("END")) throw new IllegalArgumentException("Graph manifest requires START and END");
        edges.forEach(edge -> { requireNode(nodeCodes, edge.sourceNodeCode()); requireNode(nodeCodes, edge.targetNodeCode()); });
        conditionalEdges.forEach(edge -> { requireNode(nodeCodes, edge.sourceNodeCode()); requireText(edge.conditionCode(), "conditionCode"); requireNode(nodeCodes, edge.targetNodeCode()); });
        Set<SegmentCode> segmentCodes = segments.stream().peek(Objects::requireNonNull).map(GraphSegmentSpec::segmentCode).collect(Collectors.toSet());
        if (segmentCodes.size() != segments.size()) throw new IllegalArgumentException("Graph segment codes must be unique");
        segments.forEach(segment -> { Objects.requireNonNull(segment.segmentCode(), "segmentCode"); requireNode(nodeCodes, segment.entryBoundary()); requireNode(nodeCodes, segment.exitBoundary()); });
        interruptBeforeNodes.forEach(node -> requireNode(nodeCodes, node));
        interruptAfterNodes.forEach(node -> requireNode(nodeCodes, node));
        verifyReachability(nodeCodes, edges, conditionalEdges);
    }

    private static void verifyReachability(Set<String> nodes, List<GraphEdgeSpec> edges, List<GraphConditionalEdgeSpec> conditionalEdges) {
        Map<String, List<String>> targets = java.util.stream.Stream.concat(
                        edges.stream().map(edge -> Map.entry(edge.sourceNodeCode(), edge.targetNodeCode())),
                        conditionalEdges.stream().map(edge -> Map.entry(edge.sourceNodeCode(), edge.targetNodeCode())))
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
        Set<String> reached = new HashSet<>();
        ArrayDeque<String> pending = new ArrayDeque<>(List.of("START"));
        while (!pending.isEmpty()) {
            String node = pending.removeFirst();
            if (reached.add(node)) pending.addAll(targets.getOrDefault(node, List.of()));
        }
        if (!reached.contains("END") || !reached.containsAll(nodes)) throw new IllegalArgumentException("Graph manifest contains unreachable nodes");
    }

    private static void requireNode(Set<String> nodeCodes, String nodeCode) {
        requireText(nodeCode, "nodeCode");
        if (!nodeCodes.contains(nodeCode)) throw new IllegalArgumentException("Graph edge or boundary references an unknown node");
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " must not be blank");
    }
}

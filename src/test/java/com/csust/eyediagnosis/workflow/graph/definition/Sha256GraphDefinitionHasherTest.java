package com.csust.eyediagnosis.workflow.graph.definition;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Sha256GraphDefinitionHasherTest {
    private final GraphDefinitionHasher hasher = new Sha256GraphDefinitionHasher();

    @Test
    void semanticOrderingDoesNotChangeTheHash() {
        assertEquals(hasher.hash(manifest(false)), hasher.hash(manifest(true)));
    }

    @Test
    void topologyAndActionChangesChangeTheHash() {
        var original = manifest(false);
        var alteredNode = new GraphDefinitionManifest("g", "v", "a", List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("A", "PUBLICATION"), new GraphNodeSpec("B", "ACTION"), new GraphNodeSpec("END", "BOUNDARY")),
                original.edges(), original.conditionalEdges(), original.segments(), original.interruptBeforeNodes(), original.interruptAfterNodes());
        var alteredAction = new GraphDefinitionManifest("g", "v", "a2", original.nodes(), original.edges(), original.conditionalEdges(), original.segments(), original.interruptBeforeNodes(), original.interruptAfterNodes());
        assertNotEquals(hasher.hash(original), hasher.hash(alteredNode));
        assertNotEquals(hasher.hash(original), hasher.hash(alteredAction));
        assertTrue(hasher.hash(original).matches("[0-9a-f]{64}"));
        assertFalse(hasher.hash(original).isEmpty());
    }

    private static GraphDefinitionManifest manifest(boolean reordered) {
        var nodes = List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("A", "ACTION"), new GraphNodeSpec("B", "ACTION"), new GraphNodeSpec("END", "BOUNDARY"));
        var edges = List.of(new GraphEdgeSpec("START", "A"), new GraphEdgeSpec("A", "B"));
        var conditional = List.of(new GraphConditionalEdgeSpec("B", "PASS", "END"));
        if (reordered) { nodes = List.of(nodes.get(3), nodes.get(2), nodes.get(1), nodes.get(0)); edges = List.of(edges.get(1), edges.get(0)); }
        return new GraphDefinitionManifest("g", "v", "a", nodes, edges, conditional, List.of(), List.of("A"), List.of("B"));
    }
}

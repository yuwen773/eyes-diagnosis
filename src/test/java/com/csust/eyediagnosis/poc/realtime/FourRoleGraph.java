package com.csust.eyediagnosis.poc.realtime;

import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.action.NodeAction;
import com.alibaba.cloud.ai.graph.state.strategy.ReplaceStrategy;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.alibaba.cloud.ai.graph.action.AsyncEdgeAction.edge_async;
import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;

/** Test-only graph experiment. Role actions replace external model calls, not the graph runtime. */
final class FourRoleGraph {
    record Roles(NodeAction vision, NodeAction evidence, NodeAction explanation, NodeAction critic) {}

    static CompiledGraph compile(Roles roles, CompileConfig config) throws Exception {
        // Resume loads only registered keys in 1.1.2.2; declaring the state schema is mandatory.
        var graph = new StateGraph(() -> Map.of(
                "inferenceDigest", new ReplaceStrategy(), "vision", new ReplaceStrategy(),
                "evidenceVersion", new ReplaceStrategy(), "draftVersion", new ReplaceStrategy(),
                "draftEvidenceVersion", new ReplaceStrategy(), "feedback", new ReplaceStrategy(),
                "checkedDraftVersion", new ReplaceStrategy()));
        graph.addNode("vision", node_async(roles.vision()));
        graph.addNode("evidence", node_async(roles.evidence()));
        graph.addNode("explanation", node_async(roles.explanation()));
        graph.addNode("critic", node_async(roles.critic()));
        graph.addEdge(StateGraph.START, List.of("vision", "evidence"));
        graph.addEdge(List.of("vision", "evidence"), "explanation");
        graph.addEdge("explanation", "critic");
        graph.addConditionalEdges("critic", edge_async(state -> {
            Object value = state.data().get("feedback");
            if (!(value instanceof String feedback) || !Set.of("NONE", "REWRITE", "SUPPLEMENT").contains(feedback)) {
                throw new IllegalStateException("INVALID_FEEDBACK");
            }
            // Application policy in the fixture, not a framework-provided medical or budget gate.
            if (!"NONE".equals(feedback) && state.<Integer>value("draftVersion", 0) >= 2) {
                throw new IllegalStateException("FEEDBACK_LIMIT");
            }
            return feedback;
        }),
                Map.of("NONE", StateGraph.END, "REWRITE", "explanation", "SUPPLEMENT", "evidence"));
        return graph.compile(config);
    }
}

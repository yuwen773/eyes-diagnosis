package com.csust.eyediagnosis.patientdraft;

import com.alibaba.cloud.ai.graph.*;
import com.alibaba.cloud.ai.graph.state.strategy.ReplaceStrategy;
import java.util.*;
import static com.alibaba.cloud.ai.graph.action.AsyncEdgeAction.edge_async;
import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;

/** Scheduling only. Node adapters must commit through the fenced domain transaction. */
final class DraftGraph {
    interface Nodes { Map<String, Object> invoke(String role, int version) throws Exception; }

    static CompiledGraph compile(Nodes nodes) throws Exception {
        var graph = new StateGraph(() -> Map.of(
                "draftVersion", new ReplaceStrategy(), "feedback", new ReplaceStrategy()));
        graph.addNode("vision", node_async(s -> nodes.invoke("VISION", 1)));
        graph.addNode("evidence", node_async(s -> nodes.invoke("EVIDENCE", 1)));
        graph.addNode("supplement", node_async(s -> nodes.invoke("EVIDENCE", 2)));
        graph.addNode("explanation", node_async(s -> nodes.invoke("EXPLANATION", s.<Integer>value("draftVersion", 0) + 1)));
        graph.addNode("critic", node_async(s -> nodes.invoke("CRITIC", s.<Integer>value("draftVersion", 0))));
        graph.addEdge(StateGraph.START, List.of("vision", "evidence"));
        graph.addEdge(List.of("vision", "evidence"), "explanation");
        graph.addEdge("supplement", "explanation");
        graph.addEdge("explanation", "critic");
        graph.addConditionalEdges("critic", edge_async(s -> s.<String>value("feedback").orElseThrow()),
                Map.of("NONE", StateGraph.END, "REWRITE", "explanation", "SUPPLEMENT", "supplement"));
        return graph.compile(CompileConfig.builder().build());
    }
}

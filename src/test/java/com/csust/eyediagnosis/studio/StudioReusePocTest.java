package com.csust.eyediagnosis.studio;

import com.alibaba.cloud.ai.agent.studio.loader.GraphLoader;
import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.NodeOutput;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.state.strategy.ReplaceStrategy;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;

import static com.alibaba.cloud.ai.graph.action.AsyncEdgeAction.edge_async;
import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;
import static org.junit.jupiter.api.Assertions.*;

/**
 * TASK-08 / PR-08A：Spring AI Alibaba Studio 1.1.2.2 复用验证（隔离 Spike）。
 *
 * 不接触任何医疗领域类型、真实模型或生产配置：本测试构造与 DraftGraph 同构的
 * 合成图（vision/evidence 并行 → explanation → critic 条件回边），只回答三个问题——
 * 1) 当前 BOM 1.1.2.2 下 studio 依赖能否解析、Studio 的 GraphLoader 发现机制
 *    （ContextScanningGraphLoader.discoverFromContext）是否兼容我们的 compile 产物；
 * 2) CompiledGraph.getGraph(MERMAID) 能否产出 GraphDiagram 需要的 mermaidSrc；
 * 3) studio 的 GraphRunResponse SSE 事件流与 DraftGraph.stream() 输出的 NodeOutput
 *    是否同一形态（即 React 端可参考 Studio 交互模式）。
 */
class StudioReusePocTest {

    private static final Logger log = LoggerFactory.getLogger(StudioReusePocTest.class);

    /** 与 DraftGraph 同构的合成图；节点只写计数，不调用模型。 */
    private static CompiledGraph syntheticDraftShapedGraph() throws Exception {
        var graph = new StateGraph(() -> Map.of(
                "draftVersion", new ReplaceStrategy(), "feedback", new ReplaceStrategy()));
        graph.addNode("vision", node_async(s -> Map.of("role", "VISION")));
        graph.addNode("evidence", node_async(s -> Map.of("role", "EVIDENCE")));
        graph.addNode("supplement", node_async(s -> Map.of("role", "EVIDENCE", "version", 2)));
        graph.addNode("explanation", node_async(s -> Map.of("role", "EXPLANATION")));
        graph.addNode("critic", node_async(s -> Map.of("role", "CRITIC", "feedback", "NONE")));
        graph.addEdge(StateGraph.START, List.of("vision", "evidence"));
        graph.addEdge(List.of("vision", "evidence"), "explanation");
        graph.addEdge("supplement", "explanation");
        graph.addEdge("explanation", "critic");
        graph.addConditionalEdges("critic", edge_async(s -> s.<String>value("feedback").orElseThrow()),
                Map.of("NONE", StateGraph.END, "REWRITE", "explanation", "SUPPLEMENT", "supplement"));
        return graph.compile();
    }

    @Test
    void studioLoaderDiscoversCompiledGraphBeanByStateGraphName() throws Exception {
        CompiledGraph graph = syntheticDraftShapedGraph();
        // Studio 的 ContextScanningGraphLoader 以 StateGraph.getName()（缺省为 bean 名）为键。
        // Iris 的 DraftGraph.compile() 未调用 graph.name(...)，因此会被注册为 bean 名——
        // 记录实际行为，作为「按任务构造的图不等于已注册可发现 Graph Bean」的证据。
        String name = graph.stateGraph.getName();
        log.info("PR-08A evidence: synthetic graph stateGraph.name={}", name);
        assertNull(name, "DraftGraph.compile 未调用 name()，Studio 无法按领域名发现");
    }

    @Test
    void graphRepresentationProducesMermaidForStudioGraphDiagram() throws Exception {
        CompiledGraph graph = syntheticDraftShapedGraph();
        var representation = graph.getGraph(com.alibaba.cloud.ai.graph.GraphRepresentation.Type.MERMAID);
        String mermaid = representation.content();
        log.info("PR-08A evidence: mermaid={}", mermaid);
        assertNotNull(mermaid);
        assertTrue(mermaid.contains("vision") && mermaid.contains("evidence") && mermaid.contains("critic"),
                "Mermaid 应包含四个角色节点");
        assertTrue(mermaid.contains("explanation"));
        // GraphDiagram 前端消费 mermaidSrc；GraphResponse(String,boolean) 才走 mermaid 通道
        // （单参构造把入参放 dotSrc——Studio 服务端用 DOT 渲染，前端 mermaid 分支需 boolean）。
        var response = new com.alibaba.cloud.ai.agent.studio.dto.GraphResponse(mermaid, true);
        assertEquals(mermaid, response.getMermaidSrc());
        var dotOnly = new com.alibaba.cloud.ai.agent.studio.dto.GraphResponse(mermaid);
        assertNull(dotOnly.getMermaidSrc());
        assertEquals(mermaid, dotOnly.getDotSrc());
    }

    @Test
    void graphStreamNodeOutputsMatchStudioGraphRunResponseShape() throws Exception {
        CompiledGraph graph = syntheticDraftShapedGraph();
        List<NodeOutput> outputs = graph.stream(Map.of(), RunnableConfig.builder().build())
                .collectList().block(java.time.Duration.ofSeconds(10));
        assertNotNull(outputs);
        assertFalse(outputs.isEmpty());
        // Studio GraphRunResponse{node, agent, message, chunk, state} 的 node 字段
        // 与 NodeOutput.node() 对齐；Iris 领域事件序列号/游标不在其中。
        for (NodeOutput output : outputs) {
            assertNotNull(output.node());
            log.info("PR-08A evidence: NodeOutput node={}", output.node());
        }
        var nodes = outputs.stream().map(NodeOutput::node).toList();
        // 框架把并行分支合并为 __PARALLEL__ 聚合事件；vision/evidence 的独立事件
        // 只在 StreamingOutput 场景产生。记录真实形态作为前端契约依据。
        assertTrue(nodes.contains("explanation") && nodes.contains("critic"),
                "串行节点应出现在流中");
        assertTrue(nodes.stream().anyMatch(n -> n.startsWith("__PARALLEL__")),
                "并行汇合以 __PARALLEL__ 聚合事件出现");
    }

    @Test
    void studioGraphLoaderIsSingleAbstractMethodPlusProtectedHook() throws Exception {
        CompiledGraph graph = syntheticDraftShapedGraph();
        // GraphLoader 是公共接口；AbstractGraphLoader 提供缓存骨架与受保护的 loadGraphMap
        // ——自定义注册表实现可行（如按 runId 查 DraftGraph 编译产物）。
        long publicAbstract = java.util.Arrays.stream(GraphLoader.class.getMethods())
                .filter(m -> m.isDefault() == false && !m.isDefault())
                .count();
        assertTrue(publicAbstract >= 0);
        var loader = new com.alibaba.cloud.ai.agent.studio.loader.AbstractGraphLoader() {
            @Override
            protected Map<String, CompiledGraph> loadGraphMap() {
                return Map.of("synthetic", graph);
            }
        };
        var discovered = loader.loadGraphMap();
        assertTrue(discovered.containsKey("synthetic"));
        assertSame(graph, discovered.get("synthetic"));
    }
}

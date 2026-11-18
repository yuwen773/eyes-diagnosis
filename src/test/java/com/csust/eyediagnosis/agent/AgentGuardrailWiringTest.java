package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.agent.ReactAgent;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.agent.tools.DocumentSearchTool;
import com.csust.eyediagnosis.agent.tools.EyeImageAnalyzerTool;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 运行时护栏的接线证据：模型每次都要求调工具时，一次对话回合必须能停下来，
 * 且停止的依据是可配置的预算，不是框架「碰巧」有的默认值。
 */
class AgentGuardrailWiringTest {

    private static final long USER_ID = 42L;

    @Test
    void compileConfigDerivesHardStepLimitFromModelCallLimit() {
        CompileConfig config = DiagnosisAgent.guardedCompileConfig(15);

        // 一回合 = 模型节点 + 工具节点，另留 2 步给开场与收尾
        assertEquals(15 * 2 + 2, config.recursionLimit());
        // 不写这行，框架默认塞一个 MemorySaver，每步多做一次快照
        assertTrue(config.checkpointSaver().isEmpty(), "agent 按请求重建，不应保留 thread 快照");
    }

    @Test
    void nonPositiveModelCallLimitStillProducesUsableLimit() {
        assertEquals(1 * 2 + 2, DiagnosisAgent.guardedCompileConfig(0).recursionLimit());
        assertEquals(1 * 2 + 2, DiagnosisAgent.guardedCompileConfig(-5).recursionLimit());
    }

    @Test
    void builtAgentCarriesTheConfiguredStepLimit() throws Exception {
        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(2);
        constants.setModelCallLimit(3);

        DocumentSearchTool documentSearchTool = mockDocumentSearchTool();
        ScriptedChatModel model = new ScriptedChatModel();
        ReactAgent agent = newAgent(constants, documentSearchTool, model).buildAgent(null, USER_ID);

        // 图是懒编译的：跑一次才拿得到编译结果
        agent.call("你好");

        assertNotNull(agent.getCompiledGraph(), "图必须能编译，否则护栏只是配置值");
        assertEquals(3 * 2 + 2, agent.getCompiledGraph().getMaxIterations(),
                "护栏必须真的接到图上，而不是只写了个配置方法");
        verify(documentSearchTool, times(2)).searchDocuments(anyString(), any());
    }

    @Test
    void runawayToolLoopStopsWithinTheConfiguredBudget() {
        int budget = 2;
        int modelCallLimit = 6;
        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(budget);
        constants.setModelCallLimit(modelCallLimit);

        DocumentSearchTool documentSearchTool = mockDocumentSearchTool();
        ScriptedChatModel model = new ScriptedChatModel();
        DiagnosisAgent agent = newAgent(constants, documentSearchTool, model);

        List<MessageDTO> events = agent
                .stream("我最近视力下降得厉害", null, "thread-guardrail", USER_ID, null, null)
                .collectList()
                .block(Duration.ofSeconds(60));

        assertNotNull(events, "护栏触发后流必须正常结束，而不是挂住");
        // 核心断言：模型反复要求调用，但工具只被执行预算内的次数
        verify(documentSearchTool, times(budget)).searchDocuments(anyString(), any());
        // 超预算的调用要以工具错误回到模型，不能悄悄当成成功结果
        assertTrue(model.sawBudgetErrorInPrompt(), "模型必须看到「已超上限」的工具错误，实际提示词里没有");
        // 硬上限兜底：模型调用次数被 modelCallLimit 约束住
        assertFalse(model.modelCalls() > modelCallLimit + 1,
                "模型调用次数超预算：" + model.modelCalls() + " > " + modelCallLimit + "+1");
        // 事件流里不应出现工具结果伪造
        assertTrue(events.stream().noneMatch(e -> e.getMessageType() == MessageType.TOOL_RESULT),
                "本轮未开启工具结果下发，出现 TOOL_RESULT 说明映射变了：" + summarize(events));
    }

    private static DocumentSearchTool mockDocumentSearchTool() {
        DocumentSearchTool tool = mock(DocumentSearchTool.class);
        when(tool.searchDocuments(anyString(), any())).thenReturn("[]");
        return tool;
    }

    private static DiagnosisAgent newAgent(AgentConstants constants, DocumentSearchTool documentSearchTool,
                                           ChatModel chatModel) {
        TextMcpModelInterceptor mcp = mock(TextMcpModelInterceptor.class);
        when(mcp.resolveMcpCallbacks(any(), any())).thenReturn(new ToolCallback[0]);

        DiagnosisAgent agent = new DiagnosisAgent();
        ReflectionTestUtils.setField(agent, "chatModel", chatModel);
        ReflectionTestUtils.setField(agent, "textMcpModelInterceptor", mcp);
        ReflectionTestUtils.setField(agent, "chatHistoryService", mock(ChatHistoryService.class));
        ReflectionTestUtils.setField(agent, "agentConstants", constants);
        ReflectionTestUtils.setField(agent, "eyeImageAnalyzerTool", new EyeImageAnalyzerTool());
        ReflectionTestUtils.setField(agent, "documentSearchTool", documentSearchTool);
        return agent;
    }

    private static String summarize(List<MessageDTO> events) {
        StringBuilder sb = new StringBuilder();
        for (MessageDTO e : events) {
            sb.append('[').append(e.getMessageType()).append("] ");
        }
        return sb.toString();
    }

    /** 每次都要求调用 searchDocuments 的模型：就是报告里「重复工具调用」的最坏情况。 */
    private static final class ScriptedChatModel implements ChatModel {

        private final AtomicInteger modelCalls = new AtomicInteger();
        private final List<List<Message>> prompts = Collections.synchronizedList(new ArrayList<>());

        @Override
        public ChatResponse call(Prompt prompt) {
            return nextChunk(prompt);
        }

        @Override
        public Flux<ChatResponse> stream(Prompt prompt) {
            return Flux.just(nextChunk(prompt));
        }

        private ChatResponse nextChunk(Prompt prompt) {
            prompts.add(List.copyOf(prompt.getInstructions()));
            int n = modelCalls.incrementAndGet();
            AssistantMessage message = AssistantMessage.builder()
                    .content("")
                    .toolCalls(List.of(new AssistantMessage.ToolCall(
                            "call-" + n, "function", "searchDocuments",
                            "{\"query\":\"白内障 治疗\"}")))
                    .build();
            return new ChatResponse(List.of(new Generation(message)));
        }

        int modelCalls() {
            return modelCalls.get();
        }

        /** 预算拒绝必须以工具错误的形式回到模型，而不是被吞掉。 */
        boolean sawBudgetErrorInPrompt() {
            synchronized (prompts) {
                for (List<Message> messages : prompts) {
                    for (Message message : messages) {
                        if (message instanceof ToolResponseMessage toolResponse) {
                            for (ToolResponseMessage.ToolResponse response : toolResponse.getResponses()) {
                                if (response.responseData() != null && response.responseData().contains("上限")) {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
            return false;
        }
    }
}

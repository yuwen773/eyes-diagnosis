package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor;
import com.csust.eyediagnosis.agent.service.AgentImageUploadService;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.agent.service.ToolAuditService;
import com.csust.eyediagnosis.agent.tools.DocumentSearchTool;
import com.csust.eyediagnosis.agent.tools.EyeImageAnalyzerTool;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * P1-05：预算耗尽时不能「正常结束但没有回答」。
 *
 * <p>框架在同一处用正常完成信号结束图，无论它是真答完还是撞到上限。
 * 旧实现因此把一次被截断的回合渲染成「工具都成功、然后什么都没有」。
 */
class AgentBudgetExhaustionTest {

    private static final long USER_ID = 7L;

    @Test
    void preambleBeforeToolRequestDoesNotHideModelBudgetExhaustion() {
        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(10);
        constants.setModelCallLimit(1);
        DocumentSearchTool tool = mock(DocumentSearchTool.class);
        when(tool.searchDocuments(anyString(), any())).thenReturn("[]");
        ChatHistoryService history = mock(ChatHistoryService.class);
        AtomicInteger calls = new AtomicInteger();
        ChatModel model = new ChatModel() {
            @Override public ChatResponse call(Prompt prompt) { throw new UnsupportedOperationException(); }
            @Override public Flux<ChatResponse> stream(Prompt prompt) {
                calls.incrementAndGet();
                return Flux.just(
                        new ChatResponse(List.of(new Generation(new AssistantMessage("我先查询资料。")))),
                        new ChatResponse(List.of(new Generation(AssistantMessage.builder().content("")
                                .toolCalls(List.of(new AssistantMessage.ToolCall("preamble-call", "function",
                                        "searchDocuments", "{\"query\":\"资料\"}"))).build()))));
            }
        };
        List<MessageDTO> events = newAgent(constants, tool, history, model)
                .stream("查询", null, "thread-preamble", USER_ID, null, null)
                .collectList().block(Duration.ofSeconds(30));
        assertNotNull(events);
        assertEquals("我先查询资料。本轮模型调用次数已达上限，没能生成最终回答。可以继续追问，或把问题拆小一些。",
                assistantText(events));
        assertEquals(1, calls.get(), "终止说明不得额外调用模型");
        // 旧调用方没有轮次/版本信息，两列为 null（见 DiagnosisAgent.TurnStamp.LEGACY）。
        verify(history).saveAssistantMessage("thread-preamble", USER_ID, "我先查询资料。", "text", null, null);
        assertNoticeStored(history, "thread-preamble", "MODEL_BUDGET_EXHAUSTED",
                "本轮模型调用次数已达上限，没能生成最终回答。可以继续追问，或把问题拆小一些。");
        assertEquals("MODEL_BUDGET_EXHAUSTED", events.getLast().getFinishReason());
    }

    @Test
    void toolBudgetExhaustionEndsWithAnExplicitNotice() {
        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(1);
        constants.setModelCallLimit(3);

        DocumentSearchTool tool = mock(DocumentSearchTool.class);
        when(tool.searchDocuments(anyString(), any())).thenReturn("[]");

        ChatHistoryService history = mock(ChatHistoryService.class);
        LoopToolModel model = new LoopToolModel();
        DiagnosisAgent agent = newAgent(constants, tool, history, model);

        List<MessageDTO> events = agent.stream("一直查", null, "thread-budget", USER_ID, null, null)
                .collectList().block(Duration.ofSeconds(60));
        assertNotNull(events);

        String notice = assistantText(events);
        assertEquals("本轮工具调用次数已达上限，没能生成最终回答。可以继续追问，或把问题拆小一些。", notice,
                "工具预算耗尽必须给出明确的终止说明：" + summarize(events));

        // 同一条说明要落库：刷新后回合仍然解释得清
        assertNoticeStored(history, "thread-budget", "TOOL_BUDGET_EXHAUSTED", notice);
    }

    @Test
    void modelBudgetExhaustionIsDistinguishedFromToolBudget() {
        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(10);
        constants.setModelCallLimit(1);

        DocumentSearchTool tool = mock(DocumentSearchTool.class);
        when(tool.searchDocuments(anyString(), any())).thenReturn("[]");

        ChatHistoryService history = mock(ChatHistoryService.class);
        LoopToolModel model = new LoopToolModel();
        DiagnosisAgent agent = newAgent(constants, tool, history, model);

        List<MessageDTO> events = agent.stream("一直查", null, "thread-budget-model", USER_ID, null, null)
                .collectList().block(Duration.ofSeconds(60));

        assertEquals("本轮模型调用次数已达上限，没能生成最终回答。可以继续追问，或把问题拆小一些。",
                assistantText(events), "模型调用上限与工具预算必须说清楚是哪一道：" + summarize(events));
        assertTrue(model.calls() >= 1);
        assertNoticeStored(history, "thread-budget-model", "MODEL_BUDGET_EXHAUSTED", assistantText(events));
    }

    @Test
    void normalAnswerIsNotReplacedByANotice() {
        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(5);
        constants.setModelCallLimit(1);

        DocumentSearchTool tool = mock(DocumentSearchTool.class);
        ChatHistoryService history = mock(ChatHistoryService.class);
        ChatModel model = new ChatModel() {
            @Override
            public ChatResponse call(Prompt prompt) {
                return new ChatResponse(List.of(new Generation(new AssistantMessage("这是正常回答。"))));
            }

            @Override
            public Flux<ChatResponse> stream(Prompt prompt) {
                return Flux.just(call(prompt));
            }
        };
        DiagnosisAgent agent = newAgent(constants, tool, history, model);

        List<MessageDTO> events = agent.stream("你好", null, "thread-normal", USER_ID, null, null)
                .collectList().block(Duration.ofSeconds(60));

        assertEquals("这是正常回答。", assistantText(events));
        assertTrue(assistantText(events).contains("正常回答"));
        verify(history, never()).saveAssistantMessage(eq("thread-normal"), eq(USER_ID), eq(
                "这次没有生成最终回答，可以重试或换个问法。"), eq("text"), any(), any());
        verify(history, never()).saveAssistantMessage(eq("thread-normal"), eq(USER_ID), anyString(), eq("turn-end"),
                any(), any());
    }

    private static void assertNoticeStored(ChatHistoryService history, String thread, String reason, String notice) {
        var stored = org.mockito.ArgumentCaptor.forClass(String.class);
        // 旧入口（无轮次/版本）落库时两列为 null：它们的语义是「这条历史没有版本信息」。
        verify(history).saveAssistantMessage(eq(thread), eq(USER_ID), stored.capture(), eq("turn-end"),
                isNull(), isNull());
        var payload = com.csust.eyediagnosis.utils.JsonUtils.fromJsonToMap(stored.getValue());
        assertEquals(reason, payload.get("finishReason"));
        assertEquals(notice, payload.get("output"));
    }

    private static String assistantText(List<MessageDTO> events) {
        StringBuilder sb = new StringBuilder();
        for (MessageDTO e : events) {
            if (MessageType.ASSISTANT == e.getMessageType()) sb.append(e.getContent());
        }
        return sb.toString();
    }

    private static String summarize(List<MessageDTO> events) {
        StringBuilder sb = new StringBuilder();
        for (MessageDTO e : events) {
            sb.append('[').append(e.getMessageType()).append('/').append(e.getToolStatus()).append("] ");
        }
        return sb.toString();
    }

    private static DiagnosisAgent newAgent(AgentConstants constants, DocumentSearchTool tool,
                                           ChatHistoryService history, ChatModel chatModel) {
        TextMcpModelInterceptor mcp = mock(TextMcpModelInterceptor.class);
        when(mcp.resolveMcpCallbacks(any(), any())).thenReturn(new ToolCallback[0]);
        DiagnosisAgent agent = new DiagnosisAgent();
        ReflectionTestUtils.setField(agent, "chatModel", chatModel);
        ReflectionTestUtils.setField(agent, "textMcpModelInterceptor", mcp);
        ReflectionTestUtils.setField(agent, "chatHistoryService", history);
        ReflectionTestUtils.setField(agent, "agentImageUploadService", mock(AgentImageUploadService.class));
        ReflectionTestUtils.setField(agent, "agentConstants", constants);
        ReflectionTestUtils.setField(agent, "eyeImageAnalyzerTool", mock(EyeImageAnalyzerTool.class));
        ReflectionTestUtils.setField(agent, "documentSearchTool", tool);
        ToolAuditService audit = mock(ToolAuditService.class);
        when(audit.digestKey()).thenReturn(new byte[]{1});
        ReflectionTestUtils.setField(agent, "toolAuditService", audit);
        return agent;
    }

    /** 永远要求再查一次——模拟「模型持续请求工具」，直到被预算或递归上限拦住。 */
    private static final class LoopToolModel implements ChatModel {
        private final AtomicInteger calls = new AtomicInteger();

        @Override
        public ChatResponse call(Prompt prompt) {
            return next(prompt);
        }

        @Override
        public Flux<ChatResponse> stream(Prompt prompt) {
            return Flux.just(next(prompt));
        }

        private ChatResponse next(Prompt prompt) {
            int n = calls.incrementAndGet();
            AssistantMessage message = AssistantMessage.builder()
                    .content("")
                    .toolCalls(List.of(new AssistantMessage.ToolCall(
                            "call-loop-" + n, "function", "searchDocuments", "{\"query\":\"循环\"}")))
                    .build();
            return new ChatResponse(List.of(new Generation(message)));
        }

        int calls() {
            return calls.get();
        }
    }
}

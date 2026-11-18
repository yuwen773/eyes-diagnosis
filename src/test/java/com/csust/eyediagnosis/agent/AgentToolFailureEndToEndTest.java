package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.agent.service.ToolAuditService;
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
import static org.mockito.Mockito.when;

/**
 * P0 的端到端证据：真 {@code @Tool} 抛异常 + 真 {@code ReactAgent}，不经过任何 mock 拦截器。
 *
 * <p>为什么单独立一个用例：框架 1.1.2.2 会把方法工具的
 * {@code ToolExecutionException} 走 {@code processor.process()} 转成普通响应
 * （{@code isError()==false}）。修复同时依赖两件事——把处理器配成 alwaysThrow，
 * 并让失败边界挂在拦截链最外层。这两件事任何一件被删或被重排，此前的观察者单测
 * 仍然全绿，假成功会静默复发。这里的断言直接看终态：失败就是 failed，不能是 succeeded。
 */
class AgentToolFailureEndToEndTest {

    private static final long USER_ID = 42L;

    @Test
    void realToolExceptionEndsAsFailedStateAndConversationContinues() {
        DocumentSearchTool documentSearchTool = mock(DocumentSearchTool.class);
        when(documentSearchTool.searchDocuments(anyString(), any()))
                .thenThrow(new RuntimeException("知识库检索服务 503"));

        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(5);
        constants.setModelCallLimit(5);

        ToolFailsOnceChatModel model = new ToolFailsOnceChatModel();
        DiagnosisAgent diagnosisAgent = newAgent(constants, documentSearchTool, model);

        // 走真实入口：stream() 内部才建 sink/拦截器/编译图，工具状态帧随流返回。
        List<MessageDTO> events = diagnosisAgent
                .stream("帮我查一下白内障", null, "thread-e2e", USER_ID, null, null)
                .collectList()
                .block(Duration.ofSeconds(60));

        assertNotNull(events, "工具失败后流必须正常结束，而不是把整段对话打断");

        long succeeded = events.stream()
                .filter(e -> MessageType.TOOL_RESULT == e.getMessageType())
                .filter(e -> ToolStepContract.Status.SUCCEEDED.wire().equals(e.getToolStatus()))
                .count();
        long failed = events.stream()
                .filter(e -> MessageType.TOOL_RESULT == e.getMessageType())
                .filter(e -> ToolStepContract.Status.FAILED.wire().equals(e.getToolStatus()))
                .count();
        assertEquals(0, succeeded, "真实工具异常绝不能记成成功：" + summarize(events));
        assertEquals(1, failed, "真实工具异常必须有一条失败终态：" + summarize(events));

        // 会话没有被打断：模型在收到工具错误后又被调用了一次来收尾。
        assertTrue(model.modelCalls() >= 2, "模型必须在工具失败后继续收尾，实际调用次数=" + model.modelCalls());
        assertTrue(model.sawToolException(), "模型必须收到工具失败的响应，而不是一个空成功");
        assertEquals("分析完成，工具这次没有返回内容。", model.finalText());
    }

    @Test
    void successfulToolIsStillReportedAsSucceeded() {
        // 对照组：同样的接线，工具正常返回时必须记成功——避免把边界写成「一律失败」。
        DocumentSearchTool documentSearchTool = mock(DocumentSearchTool.class);
        when(documentSearchTool.searchDocuments(anyString(), any())).thenReturn("[]");

        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(5);
        constants.setModelCallLimit(5);

        ToolFailsOnceChatModel model = new ToolFailsOnceChatModel();
        DiagnosisAgent diagnosisAgent = newAgent(constants, documentSearchTool, model);

        List<MessageDTO> events = diagnosisAgent
                .stream("帮我查一下白内障", null, "thread-e2e-ok", USER_ID, null, null)
                .collectList()
                .block(Duration.ofSeconds(60));

        long succeeded = events.stream()
                .filter(e -> MessageType.TOOL_RESULT == e.getMessageType())
                .filter(e -> ToolStepContract.Status.SUCCEEDED.wire().equals(e.getToolStatus()))
                .count();
        assertEquals(1, succeeded, "成功调用必须记成功：" + summarize(events));
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
        ReflectionTestUtils.setField(agent, "eyeImageAnalyzerTool", mock(EyeImageAnalyzerTool.class));
        ReflectionTestUtils.setField(agent, "documentSearchTool", documentSearchTool);
        ToolAuditService audit = mock(ToolAuditService.class);
        when(audit.digestKey()).thenReturn(new byte[]{1, 2, 3});
        ReflectionTestUtils.setField(agent, "toolAuditService", audit);
        return agent;
    }

    private static String summarize(List<MessageDTO> events) {
        StringBuilder sb = new StringBuilder();
        for (MessageDTO e : events) {
            sb.append('[').append(e.getMessageType()).append('/').append(e.getToolStatus()).append("] ");
        }
        return sb.toString();
    }

    /** 第一次要求调工具，看到工具响应之后给出最终回答——真实的两步 ReAct 回合。 */
    private static final class ToolFailsOnceChatModel implements ChatModel {

        private final AtomicInteger modelCalls = new AtomicInteger();
        private final List<List<Message>> prompts = Collections.synchronizedList(new ArrayList<>());
        private volatile String finalText;
        private volatile boolean sawToolException;

        @Override
        public ChatResponse call(Prompt prompt) {
            return nextChunk(prompt);
        }

        @Override
        public Flux<ChatResponse> stream(Prompt prompt) {
            return Flux.just(nextChunk(prompt));
        }

        private ChatResponse nextChunk(Prompt prompt) {
            List<Message> instructions = List.copyOf(prompt.getInstructions());
            prompts.add(instructions);
            boolean hasToolResponse = instructions.stream()
                    .anyMatch(message -> message instanceof ToolResponseMessage);
            if (hasToolResponse) {
                sawToolException = instructions.stream()
                        .filter(m -> m instanceof ToolResponseMessage)
                        .map(m -> (ToolResponseMessage) m)
                        .flatMap(m -> m.getResponses().stream())
                        .anyMatch(r -> r.responseData() != null && r.responseData().contains("503"));
            }
            int n = modelCalls.incrementAndGet();
            if (n == 1) {
                AssistantMessage message = AssistantMessage.builder()
                        .content("")
                        .toolCalls(List.of(new AssistantMessage.ToolCall(
                                "call-e2e-1", "function", "searchDocuments",
                                "{\"query\":\"白内障\"}")))
                        .build();
                return new ChatResponse(List.of(new Generation(message)));
            }
            finalText = "分析完成，工具这次没有返回内容。";
            return new ChatResponse(List.of(new Generation(new AssistantMessage(finalText))));
        }

        int modelCalls() {
            return modelCalls.get();
        }

        boolean sawToolException() {
            return sawToolException;
        }

        String finalText() {
            return finalText;
        }
    }
}

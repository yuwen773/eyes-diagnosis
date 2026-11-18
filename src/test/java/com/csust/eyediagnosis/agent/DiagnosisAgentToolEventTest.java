package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.streaming.OutputType;
import com.alibaba.cloud.ai.graph.streaming.StreamingOutput;
import com.csust.eyediagnosis.agent.observability.ToolExecutionObserver;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 工具结果闭环：框架的 {@code AGENT_TOOL_FINISHED} 输出必须变成一条
 * 带 {@code toolCallId} 与真实状态的 SSE 事件，并落库供历史回放。
 */
class DiagnosisAgentToolEventTest {

    private static final String THREAD_ID = "thread-1";
    private static final long USER_ID = 7L;

    private DiagnosisAgent agent;
    private ChatHistoryService history;
    private ToolExecutionObserver observer;

    private final StringBuilder assistantContent = new StringBuilder();
    private final StringBuilder reasoningContent = new StringBuilder();
    private final Set<String> emitted = ConcurrentHashMap.newKeySet();

    @BeforeEach
    void setUp() {
        agent = new DiagnosisAgent();
        history = mock(ChatHistoryService.class);
        observer = new ToolExecutionObserver();
        ReflectionTestUtils.setField(agent, "chatHistoryService", history);
        ReflectionTestUtils.setField(agent, "toolExecutionObserver", observer);
        ReflectionTestUtils.setField(agent, "objectMapper", new ObjectMapper());
    }

    private static StreamingOutput<?> output(org.springframework.ai.chat.messages.Message message,
                                             OutputType type) {
        return new StreamingOutput<Object>(message, null, "node", "agent", new OverAllState(), type);
    }

    private static ToolResponseMessage toolResponse(String id, String name, String data) {
        return ToolResponseMessage.builder()
                .responses(List.of(new ToolResponseMessage.ToolResponse(id, name, data)))
                .build();
    }

    private List<MessageDTO> events(org.springframework.ai.chat.messages.Message message,
                                    OutputType type) {
        return agent.toEventDtos(output(message, type), THREAD_ID, USER_ID,
                assistantContent, reasoningContent, emitted);
    }

    /** 让观察者记录一次成功执行，模拟框架真正调用了工具。 */
    private void observeSuccess(String toolCallId) {
        observer.interceptToolCall(
                new com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest(
                        "searchDocuments", "{}", toolCallId, Map.of()),
                req -> com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse
                        .of("ok", "searchDocuments", toolCallId));
    }

    @Test
    void finishedToolResponseBecomesOneToolResultEvent() {
        observeSuccess("call_1");
        List<MessageDTO> events = events(
                toolResponse("call_1", "searchDocuments", "检索到 3 段文档"),
                OutputType.AGENT_TOOL_FINISHED);

        assertEquals(1, events.size());
        MessageDTO dto = events.get(0);
        assertEquals(MessageType.TOOL_RESULT, dto.getMessageType());
        assertEquals("call_1", dto.getToolCallId());
        assertEquals("searchDocuments", dto.getToolName());
        assertEquals("success", dto.getStatus());
        assertEquals("检索到 3 段文档", dto.getContent());
        assertTrue(dto.getTimestamp().matches(".*([+-]\\d{2}:\\d{2}|Z)$"),
                "时间戳必须带偏移: " + dto.getTimestamp());
    }

    @Test
    void toolResponseIsPersistedWithCorrelationKeyAndStatus() throws Exception {
        observeSuccess("call_1");
        events(toolResponse("call_1", "searchDocuments", "检索到 3 段文档"),
                OutputType.AGENT_TOOL_FINISHED);

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(history).saveToolResultMessage(eq(THREAD_ID), eq(USER_ID), json.capture());

        JsonNode node = new ObjectMapper().readTree(json.getValue());
        assertEquals("call_1", node.get("toolCallId").asText());
        assertEquals("searchDocuments", node.get("name").asText());
        assertEquals("success", node.get("status").asText());
        assertEquals("检索到 3 段文档", node.get("output").asText());
    }

    @Test
    void streamingToolOutputIsNotEmittedAsAFinalResult() {
        List<MessageDTO> events = events(
                toolResponse("call_1", "searchDocuments", "半截结果"),
                OutputType.AGENT_TOOL_STREAMING);

        assertTrue(events.isEmpty());
        verify(history, never()).saveToolResultMessage(anyString(), eq(USER_ID), anyString());
    }

    @Test
    void sameToolCallIdIsEmittedOnlyOnce() {
        observeSuccess("call_1");
        ToolResponseMessage message = toolResponse("call_1", "searchDocuments", "结果");
        assertEquals(1, events(message, OutputType.AGENT_TOOL_FINISHED).size());
        // 框架可能同时给 STREAMING / FINISHED，重复卡片会让用户以为工具跑了两遍。
        assertTrue(events(message, OutputType.AGENT_TOOL_FINISHED).isEmpty());
        verify(history).saveToolResultMessage(eq(THREAD_ID), eq(USER_ID), anyString());
    }

    @Test
    void emptyResultIsStillAResult() {
        observeSuccess("call_1");
        List<MessageDTO> events = events(
                toolResponse("call_1", "searchDocuments", ""),
                OutputType.AGENT_TOOL_FINISHED);

        assertEquals(1, events.size());
        assertEquals("", events.get(0).getContent());
        assertEquals("success", events.get(0).getStatus());
    }

    @Test
    void withoutObservationTheStatusIsCompletedNotSuccess() {
        List<MessageDTO> events = events(
                toolResponse("call_9", "mcp__weather__forecast", "晴"),
                OutputType.AGENT_TOOL_FINISHED);

        // 框架返回了结果 ≠ 工具执行成功：没有观察依据就不许写 success。
        assertEquals("completed", events.get(0).getStatus());
    }

    @Test
    void observedFailureIsNotDisguisedAsSuccess() {
        observer.interceptToolCall(
                new com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest(
                        "searchDocuments", "{}", "call_2", Map.of()),
                req -> com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse
                        .error("检索服务不可用", "searchDocuments", "call_2"));

        List<MessageDTO> events = events(
                toolResponse("call_2", "searchDocuments", "检索服务不可用"),
                OutputType.AGENT_TOOL_FINISHED);

        assertEquals("error", events.get(0).getStatus());
    }

    @Test
    void credentialsInToolOutputAreRedactedBeforeSseAndPersistence() {
        observeSuccess("call_1");
        List<MessageDTO> events = events(
                toolResponse("call_1", "searchDocuments",
                        "Authorization: Bearer sk-live-abcdef123456\n结果：3 段文档"),
                OutputType.AGENT_TOOL_FINISHED);

        String content = events.get(0).getContent();
        assertFalse(content.contains("sk-live-abcdef123456"), content);
        assertTrue(content.contains("结果：3 段文档"), content);

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(history).saveToolResultMessage(eq(THREAD_ID), eq(USER_ID), json.capture());
        assertFalse(json.getValue().contains("sk-live-abcdef123456"));
    }

    @Test
    void oversizedToolOutputIsTruncated() {
        observeSuccess("call_1");
        List<MessageDTO> events = events(
                toolResponse("call_1", "searchDocuments", "x".repeat(40_000)),
                OutputType.AGENT_TOOL_FINISHED);

        String content = events.get(0).getContent();
        assertTrue(content.length() < 40_000);
        assertTrue(content.endsWith("（工具结果过长，已截断）"), "应明确告知被截断");
    }

    @Test
    void assistantToolCallCarriesStableIdsAndIsPersisted() throws Exception {
        AssistantMessage message = AssistantMessage.builder()
                .content("我先查一下知识库")
                .toolCalls(List.of(new AssistantMessage.ToolCall(
                        "call_a", "function", "searchDocuments", "{\"query\":\"青光眼\"}")))
                .build();

        List<MessageDTO> events = events(message, OutputType.AGENT_MODEL_STREAMING);

        assertEquals(1, events.size());
        MessageDTO dto = events.get(0);
        assertEquals(MessageType.TOOL_REQUEST, dto.getMessageType());
        assertEquals("call_a", dto.getToolCalls().get(0).get("id"));
        assertEquals("searchDocuments", dto.getToolCalls().get(0).get("name"));

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(history).saveToolCallMessage(eq(THREAD_ID), eq(USER_ID), json.capture());
        JsonNode node = new ObjectMapper().readTree(json.getValue());
        assertEquals("call_a", node.get("toolCallId").asText());
        assertEquals("{\"query\":\"青光眼\"}", node.get("arguments").asText());
    }

    @Test
    void plainAssistantChunkBecomesAssistantEvent() {
        List<MessageDTO> events = events(
                new AssistantMessage("建议先测眼压。"), OutputType.AGENT_MODEL_STREAMING);

        assertEquals(1, events.size());
        assertEquals(MessageType.ASSISTANT, events.get(0).getMessageType());
        assertEquals("建议先测眼压。", events.get(0).getContent());
        assertEquals("建议先测眼压。", assistantContent.toString());
    }
}

package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.csust.eyediagnosis.agent.guard.ToolFailureBoundaryInterceptor;
import com.csust.eyediagnosis.agent.observability.ToolResourceContext;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 工具事件闭环：状态、正文与结构化来源都只能来自真实执行。
 *
 * <p>合并后的实现只有一条工具事件链：{@link ToolExecutionInterceptor} 观察真实调用，
 * 终态经 {@link ToolStepSink} 下发给浏览器。本测试直接驱动这条链，不经过图，
 * 因此断言的是「拦截器看到了什么」，而不是模型说了什么。
 *
 * <p>失败语义的 P0 回归在 {@link #escapedToolExceptionIsReportedAsFailureThenRethrown()}
 * 与 {@link #failureBoundaryTurnsEscapedExceptionIntoRealErrorResponse()}：
 * 1.1.2.2 的 {@code AgentToolNode} 会把 {@code ToolExecutionException} 转成普通
 * 成功响应（{@code ToolCallResponse.of} → status 为 null → isError()==false），
 * 谁在拦截器里只信 {@code isError()} 谁就会把真实失败记成 success。
 */
class DiagnosisAgentToolEventTest {

    private static final String THREAD_ID = "thread-1";
    private static final long USER_ID = 7L;

    private ChatHistoryService history;
    private ToolStepSink sink;
    private ToolExecutionInterceptor interceptor;
    private List<ToolStepSink.ToolAuditRecord> audit;

    @BeforeEach
    void setUp() {
        history = mock(ChatHistoryService.class);
        audit = new ArrayList<>();
        sink = new ToolStepSink(THREAD_ID, USER_ID, audit::add);
        interceptor = new ToolExecutionInterceptor(sink, new byte[]{1, 2, 3});
    }

    private ToolCallRequest request(String toolCallId, String name) {
        return new ToolCallRequest(name, "{\"query\":\"青光眼\"}", toolCallId, Map.of());
    }

    @Test
    void successfulCallEmitsRunningThenSucceededWithContent() {
        List<MessageDTO> collected = new ArrayList<>();
        sink.events().asFlux().subscribe(collected::add);

        interceptor.interceptToolCall(request("call_1", "searchDocuments"),
                req -> ToolCallResponse.of("call_1", "searchDocuments", "检索到 3 段文档"));

        assertEquals(2, collected.size(), "一次调用应有 RUNNING 与终态两条");
        assertEquals(ToolStepContract.Status.RUNNING.wire(), collected.get(0).getToolStatus());
        MessageDTO terminal = collected.get(1);
        assertEquals(MessageType.TOOL_RESULT, terminal.getMessageType());
        assertEquals(ToolStepContract.Status.SUCCEEDED.wire(), terminal.getToolStatus());
        assertEquals("call_1", terminal.getToolCallId());
        assertEquals("searchDocuments", terminal.getToolName());
        assertEquals("检索到 3 段文档", terminal.getContent());
        assertTrue(terminal.getTimestamp().matches(".*([+-]\\d{2}:\\d{2}|Z)$"),
                "时间戳必须带偏移: " + terminal.getTimestamp());
        assertEquals("STOP", terminal.getFinishReason());
    }

    @Test
    void errorResponseIsRecordedAsFailureWithoutResources() {
        List<MessageDTO> collected = new ArrayList<>();
        sink.events().asFlux().subscribe(collected::add);

        interceptor.interceptToolCall(request("call_2", "searchDocuments"), req -> {
            ToolResourceContext.record(ResourceRef.document("43", "不该出现的来源", 0.5, null, "片段", null));
            return ToolCallResponse.error("call_2", "searchDocuments", "检索服务不可用");
        });

        MessageDTO terminal = collected.get(collected.size() - 1);
        assertEquals(ToolStepContract.Status.FAILED.wire(), terminal.getToolStatus());
        assertNull(terminal.getResources(), "失败的工具结果不得带任何来源");
        assertFalse(collected.stream().anyMatch(e ->
                ToolStepContract.Status.SUCCEEDED.wire().equals(e.getToolStatus())));
    }

    /**
     * P0 回归：框架的异常处理可能把抛出包装成「普通返回」。拦截器必须把
     * 逃出来的异常记成失败并原样抛出，交给最外层边界转成真正的错误响应。
     */
    @Test
    void escapedToolExceptionIsReportedAsFailureThenRethrown() {
        List<MessageDTO> collected = new ArrayList<>();
        sink.events().asFlux().subscribe(collected::add);

        RuntimeException thrown = assertThrows(RuntimeException.class, () ->
                interceptor.interceptToolCall(request("call_3", "searchDocuments"),
                        req -> { throw new IllegalStateException("chroma down"); }));

        assertNotNull(thrown);
        MessageDTO terminal = collected.get(collected.size() - 1);
        assertEquals(ToolStepContract.Status.FAILED.wire(), terminal.getToolStatus());
        assertEquals("", terminal.getContent(), "失败不应带工具正文");
    }

    @Test
    void failureBoundaryTurnsEscapedExceptionIntoRealErrorResponse() {
        ToolFailureBoundaryInterceptor boundary = new ToolFailureBoundaryInterceptor();

        ToolCallResponse response = boundary.interceptToolCall(
                request("call_4", "searchDocuments"),
                req -> { throw new IllegalStateException("chroma down"); });

        assertTrue(response.isError(), "边界必须产出真正的错误响应，而不是 ToolCallResponse.of");
    }

    @Test
    void timeoutCauseIsCategorisedAsTimeoutNotGenericFailure() {
        // 框架会把工具异常包一层：只看最外层类名会把超时记成普通失败。
        assertThrows(RuntimeException.class, () ->
                interceptor.interceptToolCall(request("call_5", "searchDocuments"),
                        req -> { throw new RuntimeException(new java.util.concurrent.TimeoutException("slow")); }));
        assertEquals(ToolStepContract.ErrorCategory.TIMEOUT, audit.get(audit.size() - 1).errorCategory());
    }

    @Test
    void emptyResultIsStillASuccessfulResult() {
        List<MessageDTO> collected = new ArrayList<>();
        sink.events().asFlux().subscribe(collected::add);

        interceptor.interceptToolCall(request("call_6", "searchDocuments"),
                req -> ToolCallResponse.of("call_6", "searchDocuments", ""));

        MessageDTO terminal = collected.get(collected.size() - 1);
        assertEquals(ToolStepContract.Status.SUCCEEDED.wire(), terminal.getToolStatus());
        assertEquals("", terminal.getContent());
    }

    @Test
    void successfulToolCallCarriesStructuredResources() {
        List<MessageDTO> collected = new ArrayList<>();
        sink.events().asFlux().subscribe(collected::add);

        interceptor.interceptToolCall(request("call_r1", "searchDocuments"), req -> {
            ToolResourceContext.record(ResourceRef.document(
                    "42", "干眼症诊疗共识", 0.81, null, "睑板腺功能障碍是干眼的主要原因之一。", null));
            return ToolCallResponse.of("call_r1", "searchDocuments", "找到 1 段文档");
        });

        MessageDTO terminal = collected.get(collected.size() - 1);
        assertEquals(1, terminal.getResources().size());
        ResourceRef ref = terminal.getResources().get(0);
        assertEquals("document", ref.kind());
        assertEquals("42", ref.documentId());
        assertEquals("call_r1", ref.toolCallId(), "资源必须补回本次调用的 id");
    }

    @Test
    void credentialsInToolOutputAreRedactedBeforeDelivery() {
        List<MessageDTO> collected = new ArrayList<>();
        sink.events().asFlux().subscribe(collected::add);

        interceptor.interceptToolCall(request("call_7", "searchDocuments"),
                req -> ToolCallResponse.of("call_7", "searchDocuments",
                        "Authorization: Bearer sk-live-abcdef123456\n结果：3 段文档"));

        String content = collected.get(collected.size() - 1).getContent();
        assertFalse(content.contains("sk-live-abcdef123456"), content);
        assertTrue(content.contains("结果：3 段文档"), content);
    }

    @Test
    void oversizedToolOutputIsTruncated() {
        List<MessageDTO> collected = new ArrayList<>();
        sink.events().asFlux().subscribe(collected::add);

        interceptor.interceptToolCall(request("call_8", "searchDocuments"),
                req -> ToolCallResponse.of("call_8", "searchDocuments", "x".repeat(40_000)));

        String content = collected.get(collected.size() - 1).getContent();
        assertTrue(content.length() < 40_000);
        assertTrue(content.endsWith("（工具结果过长，已截断）"), "应明确告知被截断");
    }

    @Test
    void terminalStateIsPersistedWithCorrelationKeyAndStatus() throws Exception {
        DiagnosisAgent agent = new DiagnosisAgent();
        ReflectionTestUtils.setField(agent, "chatHistoryService", history);

        MessageDTO terminal = new MessageDTO();
        terminal.setMessageType(MessageType.TOOL_RESULT);
        terminal.setToolCallId("call_1");
        terminal.setToolName("searchDocuments");
        terminal.setToolStatus(ToolStepContract.Status.SUCCEEDED.wire());
        terminal.setContent("检索到 3 段文档");

        ReflectionTestUtils.invokeMethod(agent, "persistTerminalToolResult", THREAD_ID, USER_ID, terminal,
                DiagnosisAgent.TurnStamp.LEGACY);

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(history).saveToolResultMessage(eq(THREAD_ID), eq(USER_ID), json.capture(), isNull(), isNull());
        JsonNode node = new ObjectMapper().readTree(json.getValue());
        assertEquals("call_1", node.get("toolCallId").asText());
        assertEquals("searchDocuments", node.get("name").asText());
        assertEquals("succeeded", node.get("status").asText());
        assertEquals("检索到 3 段文档", node.get("output").asText());
        assertFalse(node.has("resources"), "没有来源就不写这个键");
    }

    @Test
    void runningStateIsNotPersisted() {
        DiagnosisAgent agent = new DiagnosisAgent();
        ReflectionTestUtils.setField(agent, "chatHistoryService", history);

        MessageDTO running = new MessageDTO();
        running.setToolCallId("call_1");
        running.setToolStatus(ToolStepContract.Status.RUNNING.wire());

        ReflectionTestUtils.invokeMethod(agent, "persistTerminalToolResult", THREAD_ID, USER_ID, running,
                DiagnosisAgent.TurnStamp.LEGACY);

        verify(history, org.mockito.Mockito.never())
                .saveToolResultMessage(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.any(Long.class),
                        org.mockito.ArgumentMatchers.anyString(), any(), any());
    }
}

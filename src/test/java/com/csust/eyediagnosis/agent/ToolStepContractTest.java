package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A1/A2 backend contract: completion states come only from the real tool handler,
 * labels come from a closed whitelist, and pending calls are cancelled rather than
 * reported as successful when the stream ends without a result.
 */
class ToolStepContractTest {

    private static final byte[] KEY = "unit-test-key".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    private static ToolCallRequest request(String id, String name, String args) {
        return ToolCallRequest.builder()
                .toolCallId(id)
                .toolName(name)
                .arguments(args)
                .build();
    }

    /** Collect all events emitted so far; the sink must already be closed. */
    private static List<MessageDTO> eventsOf(ToolStepSink sink) {
        List<MessageDTO> events = new ArrayList<>();
        sink.events().asFlux().doOnNext(events::add).blockLast();
        return events;
    }

    @Test
    void labelsAreFixedWhitelistAndNeverModelText() {
        assertEquals("检索医学知识库", ToolStepContract.stepLabel("searchDocuments"));
        assertEquals("分析眼底图像", ToolStepContract.stepLabel("analyzeEyeImage"));
        assertEquals("调用工具", ToolStepContract.stepLabel("evilToolWithPatientName"));
        assertEquals("调用工具", ToolStepContract.stepLabel(null));
        assertTrue(ToolStepContract.isKnown("searchDocuments"));
        assertFalse(ToolStepContract.isKnown("mcpProvidedTool"));
    }

    @Test
    void successIsEmittedOnlyAfterRealHandlerResult() {
        ToolStepSink sink = new ToolStepSink("s1", 7L, null);
        ToolExecutionInterceptor interceptor = new ToolExecutionInterceptor(sink, KEY);

        ToolCallResponse response = interceptor.interceptToolCall(
                request("call-1", "searchDocuments", "{\"query\":\"x\"}"),
                req -> ToolCallResponse.of("call-1", "searchDocuments", "ok"));
        sink.closePending();

        assertFalse(response.isError());
        List<MessageDTO> events = eventsOf(sink);
        assertEquals(2, events.size());
        assertEquals(MessageType.TOOL_RESULT, events.get(0).getMessageType());
        assertEquals(ToolStepContract.Status.RUNNING.wire(), events.get(0).getToolStatus());
        assertNull(events.get(0).getFinishReason());
        assertEquals("call-1", events.get(1).getToolCallId());
        assertEquals(ToolStepContract.Status.SUCCEEDED.wire(), events.get(1).getToolStatus());
        assertEquals("STOP", events.get(1).getFinishReason());
        assertEquals("检索医学知识库", events.get(1).getStepLabel());
    }

    @Test
    void errorResponseAndThrownExceptionBothProduceFailedNeverSucceeded() {
        ToolStepSink errorSink = new ToolStepSink("s1", 7L, null);
        new ToolExecutionInterceptor(errorSink, KEY).interceptToolCall(
                request("call-2", "searchDocuments", "{}"),
                req -> ToolCallResponse.error("call-2", "searchDocuments", "boom"));
        errorSink.closePending();
        List<MessageDTO> errorEvents = eventsOf(errorSink);
        assertEquals(ToolStepContract.Status.FAILED.wire(), errorEvents.get(1).getToolStatus());
        assertEquals("TOOL_ERROR", errorEvents.get(1).getFinishReason());

        ToolStepSink throwSink = new ToolStepSink("s1", 7L, null);
        assertThrows(IllegalStateException.class, () ->
                new ToolExecutionInterceptor(throwSink, KEY).interceptToolCall(
                        request("call-3", "analyzeEyeImage", "{}"),
                        req -> { throw new IllegalStateException("tool crashed"); }));
        throwSink.closePending();
        List<MessageDTO> throwEvents = eventsOf(throwSink);
        assertEquals(ToolStepContract.Status.FAILED.wire(), throwEvents.get(1).getToolStatus());
        assertEquals("TOOL_EXCEPTION", throwEvents.get(1).getErrorCategory());
    }

    @Test
    void streamCloseWithoutResultCancelsPendingAndNeverClaimsSuccess() {
        // A call that was intercepted but whose handler never returned: exactly the
        // abort/disconnect case. No FAILED event either — we have no result at all.
        ToolStepSink sink = new ToolStepSink("s1", 7L, null);
        sink.started("call-5", "analyzeEyeImage", null, null);
        sink.closePending();

        List<MessageDTO> events = eventsOf(sink);
        assertEquals(2, events.size());
        assertEquals("call-5", events.get(0).getToolCallId());
        assertEquals(ToolStepContract.Status.RUNNING.wire(), events.get(0).getToolStatus());
        assertEquals("call-5", events.get(1).getToolCallId());
        assertEquals(ToolStepContract.Status.CANCELLED.wire(), events.get(1).getToolStatus());
        assertEquals("INTERRUPTED", events.get(1).getFinishReason());
        assertEquals("CANCELLED", events.get(1).getErrorCategory());
        assertNotEquals("STOP", events.get(1).getFinishReason());
    }

    @Test
    void completedCallIsNotCancelledAgainOnClose() {
        ToolStepSink sink = new ToolStepSink("s1", 7L, null);
        new ToolExecutionInterceptor(sink, KEY).interceptToolCall(
                request("call-7", "searchDocuments", "{}"),
                req -> ToolCallResponse.of("call-7", "searchDocuments", "ok"));
        sink.closePending();

        List<MessageDTO> events = eventsOf(sink);
        assertEquals(2, events.size(), "closePending must not emit a second terminal event");
        assertEquals(ToolStepContract.Status.SUCCEEDED.wire(), events.get(1).getToolStatus());
    }

    @Test
    void concurrentCallsKeepTheirOwnIds() {
        ToolStepSink sink = new ToolStepSink("s1", 7L, null);
        ToolExecutionInterceptor interceptor = new ToolExecutionInterceptor(sink, KEY);
        interceptor.interceptToolCall(request("a", "searchDocuments", "{}"),
                req -> ToolCallResponse.of("a", "searchDocuments", "ok"));
        interceptor.interceptToolCall(request("b", "analyzeEyeImage", "{}"),
                req -> ToolCallResponse.error("b", "analyzeEyeImage", "bad"));
        sink.closePending();

        List<MessageDTO> events = eventsOf(sink);
        assertEquals(4, events.size());
        assertEquals("a", events.get(0).getToolCallId());
        assertEquals("a", events.get(1).getToolCallId());
        assertEquals(ToolStepContract.Status.SUCCEEDED.wire(), events.get(1).getToolStatus());
        assertEquals("b", events.get(2).getToolCallId());
        assertEquals("b", events.get(3).getToolCallId());
        assertEquals(ToolStepContract.Status.FAILED.wire(), events.get(3).getToolStatus());
    }

    @Test
    void statusEventsNeverCarryRawArgumentsOrPrompts() {
        ToolStepSink sink = new ToolStepSink("s1", 7L, null);
        new ToolExecutionInterceptor(sink, KEY).interceptToolCall(
                request("call-6", "searchDocuments",
                        "{\"query\":\"patient-张三-apiKey-SECRET\",\"note\":\"diagnosis\"}"),
                req -> ToolCallResponse.of("call-6", "searchDocuments", "ok"));
        sink.closePending();

        for (MessageDTO dto : eventsOf(sink)) {
            assertEquals("", dto.getContent());
            assertNull(dto.getToolCalls());
            assertFalse(String.valueOf(dto).contains("张三"));
            assertFalse(String.valueOf(dto).contains("SECRET"));
            assertFalse(String.valueOf(dto).contains("query"));
        }
    }

    @Test
    void auditDigestIsHmacOverSortedKeyNamesOnlyAndIgnoresValues() {
        List<ToolStepSink.ToolAuditRecord> recordsA = new ArrayList<>();
        List<ToolStepSink.ToolAuditRecord> recordsB = new ArrayList<>();
        ToolStepSink sinkA = new ToolStepSink("s", 1L, recordsA::add);
        ToolStepSink sinkB = new ToolStepSink("s", 1L, recordsB::add);
        new ToolExecutionInterceptor(sinkA, KEY).interceptToolCall(
                request("x", "searchDocuments", "{\"b\":\"secret-1\",\"a\":\"patient-1\"}"),
                req -> ToolCallResponse.of("x", "searchDocuments", "ok"));
        new ToolExecutionInterceptor(sinkB, KEY).interceptToolCall(
                request("x", "searchDocuments", "{\"a\":\"patient-2\",\"b\":\"secret-2\"}"),
                req -> ToolCallResponse.of("x", "searchDocuments", "ok"));

        String digestA = recordsA.get(0).argsDigest();
        String digestB = recordsB.get(0).argsDigest();
        assertEquals(64, digestA.length());
        assertEquals(digestA, digestB, "same key set → same digest regardless of values");
        assertEquals("a,b", recordsA.get(0).argsKeyNames());
        assertFalse(digestA.contains("secret"));
        // Different key sets must not collide.
        List<ToolStepSink.ToolAuditRecord> recordsC = new ArrayList<>();
        ToolStepSink sinkC = new ToolStepSink("s", 1L, recordsC::add);
        new ToolExecutionInterceptor(sinkC, KEY).interceptToolCall(
                request("y", "searchDocuments", "{\"c\":\"v\"}"),
                req -> ToolCallResponse.of("y", "searchDocuments", "ok"));
        assertNotEquals(digestA, recordsC.get(0).argsDigest());
    }
}

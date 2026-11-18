package com.csust.eyediagnosis.agent.observability;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallHandler;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 工具观察者只说它看到的事实：成功、错误、超时、中断、以及“什么都没看到”。
 */
class ToolExecutionObserverTest {

    private final ToolExecutionObserver observer = new ToolExecutionObserver();

    private static ToolCallRequest request(String id) {
        return new ToolCallRequest("searchDocuments", "{\"query\":\"青光眼\"}", id, Map.of());
    }

    @Test
    void successfulCallIsRecordedAsSuccess() {
        ToolCallResponse ok = ToolCallResponse.of("找到 3 段文档", "searchDocuments", "call_1");
        ToolCallResponse returned = observer.interceptToolCall(request("call_1"), req -> ok);

        assertSame(ok, returned);
        assertEquals("success", observer.peek("call_1").status());
        assertNull(observer.peek("call_1").errorType());
    }

    @Test
    void errorResponseIsRecordedAsError() {
        ToolCallResponse error = ToolCallResponse.error("检索失败", "searchDocuments", "call_2");
        observer.interceptToolCall(request("call_2"), req -> error);

        assertEquals("error", observer.peek("call_2").status());
    }

    @Test
    void thrownTimeoutIsRecordedAndRethrown() {
        RuntimeException bubbling = new RuntimeException(new TimeoutException("检索超时"));
        RuntimeException thrown = assertThrows(RuntimeException.class,
                () -> observer.interceptToolCall(request("call_3"), req -> {
                    throw bubbling;
                }));

        // 观察者不改行为：异常原样交给框架，由框架决定如何呈现失败。
        assertSame(bubbling, thrown);
        assertEquals("timeout", observer.peek("call_3").status());
    }

    @Test
    void cancellationIsRecordedAsCancelled() {
        assertThrows(CancellationException.class,
                () -> observer.interceptToolCall(request("call_4"), req -> {
                    throw new CancellationException("用户中止");
                }));

        assertEquals("cancelled", observer.peek("call_4").status());
    }

    @Test
    void ordinaryFailureIsRecordedAsError() {
        assertThrows(IllegalStateException.class,
                () -> observer.interceptToolCall(request("call_5"), req -> {
                    throw new IllegalStateException("boom");
                }));

        assertEquals("error", observer.peek("call_5").status());
        assertEquals("IllegalStateException", observer.peek("call_5").errorType());
    }

    @Test
    void unknownOrBlankIdHasNoOutcome() {
        assertNull(observer.peek("never-seen"));
        assertNull(observer.peek(null));
        assertNull(observer.peek("  "));
    }

    @Test
    void missingToolCallIdDoesNotPolluteOtherEntries() {
        ToolCallResponse ok = ToolCallResponse.of("结果", "searchDocuments", null);
        observer.interceptToolCall(new ToolCallRequest("searchDocuments", "{}", null, Map.of()),
                (ToolCallHandler) req -> ok);

        assertNull(observer.peek(null));
        assertNull(observer.peek(""));
    }

    @Test
    void laterOutcomeReplacesEarlierOneForTheSameCall() {
        observer.interceptToolCall(request("call_6"),
                (ToolCallHandler) req -> ToolCallResponse.error("先失败", "searchDocuments", "call_6"));
        observer.interceptToolCall(request("call_6"),
                (ToolCallHandler) req -> ToolCallResponse.of("后成功", "searchDocuments", "call_6"));

        assertEquals("success", observer.peek("call_6").status());
    }

    @Test
    void resourcesRecordedDuringSuccessfulCallAreKeptAndTaggedWithTheCallId() {
        observer.interceptToolCall(request("call_r1"), req -> {
            ToolResourceContext.record(ResourceRef.document("42", "干眼症诊疗共识", 0.81, null, "片段", null));
            return ToolCallResponse.of("找到 1 段文档", "searchDocuments", "call_r1");
        });

        ToolExecutionObserver.Outcome outcome = observer.peek("call_r1");
        assertEquals("success", outcome.status());
        assertEquals(1, outcome.resources().size());
        assertEquals("42", outcome.resources().get(0).documentId());
        // 工具自己不知道框架分配的 toolCallId，由观察者补齐。
        assertEquals("call_r1", outcome.resources().get(0).toolCallId());
    }

    @Test
    void failedCallCarriesNoResourcesEvenIfTheToolRegisteredSome() {
        observer.interceptToolCall(request("call_r2"), req -> {
            ToolResourceContext.record(ResourceRef.document("43", "不该出现的来源", 0.5, null, "片段", null));
            return ToolCallResponse.error("检索失败", "searchDocuments", "call_r2");
        });

        assertEquals("error", observer.peek("call_r2").status());
        assertTrue(observer.peek("call_r2").resources().isEmpty(),
                "失败的工具调用不能留下任何「证据」");
    }

    @Test
    void thrownCallDropsResourcesAndLeavesNoResidueForTheNextCall() {
        assertThrows(IllegalStateException.class,
                () -> observer.interceptToolCall(request("call_r3"), req -> {
                    ToolResourceContext.record(ResourceRef.document("44", "残渣", 0.4, null, "片段", null));
                    throw new IllegalStateException("boom");
                }));
        assertTrue(observer.peek("call_r3").resources().isEmpty());

        observer.interceptToolCall(request("call_r4"), req -> ToolCallResponse.of("ok", "searchDocuments", "call_r4"));
        assertTrue(observer.peek("call_r4").resources().isEmpty(),
                "上一次调用登记的资源不能串到下一次");
    }
}

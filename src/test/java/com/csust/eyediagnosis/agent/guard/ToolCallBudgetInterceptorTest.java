package com.csust.eyediagnosis.agent.guard;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ToolCallBudgetInterceptorTest {

    private static ToolCallRequest request(String id) {
        return ToolCallRequest.builder()
                .toolName("searchDocuments")
                .toolCallId(id)
                .arguments("{}")
                .build();
    }

    @Test
    void callsWithinBudgetReachTheTool() {
        ToolCallBudgetInterceptor budget = new ToolCallBudgetInterceptor(2);
        AtomicInteger executed = new AtomicInteger();

        ToolCallResponse first = budget.interceptToolCall(request("a"),
                req -> ToolCallResponse.of(req.getToolCallId(), req.getToolName(), increment(executed)));
        ToolCallResponse second = budget.interceptToolCall(request("b"),
                req -> ToolCallResponse.of(req.getToolCallId(), req.getToolName(), increment(executed)));

        assertEquals(2, executed.get());
        assertFalse(first.isError());
        assertFalse(second.isError());
        assertEquals(2, budget.used());
    }

    @Test
    void callBeyondBudgetIsRejectedWithoutExecutingTheTool() {
        ToolCallBudgetInterceptor budget = new ToolCallBudgetInterceptor(1);
        AtomicInteger executed = new AtomicInteger();

        budget.interceptToolCall(request("a"),
                req -> ToolCallResponse.of(req.getToolCallId(), req.getToolName(), increment(executed)));
        ToolCallResponse rejected = budget.interceptToolCall(request("b"),
                req -> ToolCallResponse.of(req.getToolCallId(), req.getToolName(), increment(executed)));

        assertEquals(1, executed.get(), "超预算的那次调用不能落到工具上");
        assertTrue(rejected.isError());
        assertEquals("b", rejected.getToolCallId());
        // 拒绝理由必须能指导模型收尾，而不是一句无信息的失败
        assertTrue(rejected.getResult().contains("上限"));
    }

    @Test
    void budgetExhaustionKeepsRejectingInsteadOfLettingThrough() {
        ToolCallBudgetInterceptor budget = new ToolCallBudgetInterceptor(1);
        AtomicInteger executed = new AtomicInteger();

        budget.interceptToolCall(request("a"),
                req -> ToolCallResponse.of(req.getToolCallId(), req.getToolName(), increment(executed)));
        for (int i = 0; i < 5; i++) {
            assertTrue(budget.interceptToolCall(request("x" + i),
                    req -> ToolCallResponse.of(req.getToolCallId(), req.getToolName(), increment(executed))).isError());
        }

        assertEquals(1, executed.get());
        assertEquals(6, budget.used());
    }

    @Test
    void nonPositiveBudgetIsRejectedAtConstruction() {
        assertThrows(IllegalArgumentException.class, () -> new ToolCallBudgetInterceptor(0));
        assertThrows(IllegalArgumentException.class, () -> new ToolCallBudgetInterceptor(-3));
    }

    private static String increment(AtomicInteger counter) {
        return "ok-" + counter.incrementAndGet();
    }
}

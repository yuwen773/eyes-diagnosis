package com.csust.eyediagnosis.agent.observability;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallHandler;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolInterceptor;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 工具执行结果的旁路观察者。
 *
 * <p>Spring AI Alibaba 的 {@code AGENT_TOOL_FINISHED} 流事件只带
 * {@code ToolResponseMessage}（id / name / responseData），不携带成功或失败。
 * 但框架提供了 {@link ToolInterceptor} 这一等价的扩展点：它在工具真正执行的
 * 前后被调用，异常也会从这里经过。这里只<b>记录</b>结果，不改变返回值，
 * 也不吞异常——失败的事实必须原样交给框架处理。
 *
 * <p>键是 {@code toolCallId}，与 SSE 里的 {@code toolCallId} 一致，前端据此
 * 把「请求」和「结果」配成同一步。没有记录时调用方只能标「已返回、未区分
 * 成败」，不能猜成成功。
 */
@Component
public class ToolExecutionObserver extends ToolInterceptor {

    /** 观察结果。status 取 success / error / timeout / cancelled。 */
    public record Outcome(String status, String errorType, long finishedAt) {
    }

    private static final int MAX_ENTRIES = 4096;

    /** 访问序 LRU：流结束很久之后仍被查询的条目自然淘汰，避免无界增长。 */
    private final Map<String, Outcome> outcomes = Collections.synchronizedMap(
            new LinkedHashMap<>(256, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Outcome> eldest) {
                    return size() > MAX_ENTRIES;
                }
            });

    @Override
    public String getName() {
        return "tool-execution-observer";
    }

    @Override
    public ToolCallResponse interceptToolCall(ToolCallRequest request, ToolCallHandler handler) {
        String toolCallId = request != null ? request.getToolCallId() : null;
        try {
            ToolCallResponse response = handler.call(request);
            if (response != null && response.isError()) {
                remember(toolCallId, "error", "ToolCallResponse.error", System.currentTimeMillis());
            } else {
                remember(toolCallId, "success", null, System.currentTimeMillis());
            }
            return response;
        } catch (RuntimeException e) {
            remember(toolCallId, classify(e), e.getClass().getSimpleName(), System.currentTimeMillis());
            throw e;
        }
    }

    /** 结果未知时返回 null——调用方不得把它当成成功。 */
    public Outcome peek(String toolCallId) {
        if (toolCallId == null || toolCallId.isBlank()) {
            return null;
        }
        return outcomes.get(toolCallId);
    }

    private void remember(String toolCallId, String status, String errorType, long finishedAt) {
        if (toolCallId == null || toolCallId.isBlank()) {
            return;
        }
        outcomes.put(toolCallId, new Outcome(status, errorType, finishedAt));
    }

    private static String classify(Throwable error) {
        Throwable cursor = error;
        for (int depth = 0; cursor != null && depth < 8; depth++) {
            if (cursor instanceof java.util.concurrent.TimeoutException) {
                return "timeout";
            }
            if (cursor instanceof java.util.concurrent.CancellationException
                    || cursor instanceof InterruptedException) {
                return "cancelled";
            }
            String simple = cursor.getClass().getSimpleName().toLowerCase();
            if (simple.contains("timeout")) {
                return "timeout";
            }
            if (simple.contains("cancel") || simple.contains("interrupt")) {
                return "cancelled";
            }
            Throwable next = cursor.getCause();
            cursor = next == cursor ? null : next;
        }
        return "error";
    }
}

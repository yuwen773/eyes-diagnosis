package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * P1-01：失败类别必须活过「框架把异常转成错误响应」这一步。
 *
 * <p>MCP 工具的异常到不了拦截器的 catch 分支——框架先把它转成
 * {@code ToolCallResponse.error}。只看 {@code isError()} 的话，超时、取消、
 * 无效输出都会记成同一个 TOOL_EXCEPTION，前端与历史也没法区分。
 */
class ToolFailureCategoryTest {

    private static final String THREAD = "thread-cat";
    private static final long USER = 7L;

    private static ToolCallRequest request(String id, String name) {
        return new ToolCallRequest(name, "{\"query\":\"x\"}", id, Map.of());
    }

    @Test
    void taggedTimeoutInErrorResponseSurvivesAsTimeout() {
        List<MessageDTO> events = new ArrayList<>();
        List<ToolStepSink.ToolAuditRecord> audit = new ArrayList<>();
        ToolStepSink sink = new ToolStepSink(THREAD, USER, audit::add);
        sink.events().asFlux().subscribe(events::add);
        ToolExecutionInterceptor interceptor = new ToolExecutionInterceptor(sink, new byte[]{1});

        ToolCallResponse returned = interceptor.interceptToolCall(request("call-t", "remoteSearch"),
                req -> ToolCallResponse.error("call-t", "remoteSearch",
                        ToolStepContract.tagError(ToolStepContract.ErrorCategory.TIMEOUT,
                                "MCP 工具调用超时，请稍后重试")));

        MessageDTO terminal = events.get(1);
        assertEquals(ToolStepContract.Status.FAILED.wire(), terminal.getToolStatus());
        assertEquals("TIMEOUT", terminal.getErrorCategory(), "超时不能被抹成普通异常");
        assertEquals("TOOL_ERROR", terminal.getFinishReason());

        ToolStepSink.ToolAuditRecord finish = audit.get(1);
        assertEquals(ToolStepContract.ErrorCategory.TIMEOUT, finish.errorCategory());

        // 标记只服务于观察者：交给模型的文本里不该出现内部标记
        assertTrue(returned.isError());
        assertTrue(returned.getResult().contains("超时"));
        assertTrue(!returned.getResult().contains("TOOL_ERROR:"),
                "内部标记不能泄漏给模型: " + returned.getResult());
    }

    @Test
    void untaggedErrorResponseStaysGenericFailure() {
        List<MessageDTO> events = new ArrayList<>();
        ToolStepSink sink = new ToolStepSink(THREAD, USER, record -> { });
        sink.events().asFlux().subscribe(events::add);
        ToolExecutionInterceptor interceptor = new ToolExecutionInterceptor(sink, new byte[]{1});

        interceptor.interceptToolCall(request("call-g", "remoteSearch"),
                req -> ToolCallResponse.error("call-g", "remoteSearch", "远端返回 500"));

        MessageDTO terminal = events.get(1);
        assertEquals("TOOL_EXCEPTION", terminal.getErrorCategory(), "没有类别标记就不要猜");
        assertEquals(ToolStepContract.Status.FAILED.wire(), terminal.getToolStatus());
    }

    @Test
    void taggedExceptionThrownThroughTheInterceptorKeepsItsCategory() {
        List<ToolStepSink.ToolAuditRecord> audit = new ArrayList<>();
        ToolStepSink sink = new ToolStepSink(THREAD, USER, audit::add);
        sink.events().asFlux().subscribe();
        ToolExecutionInterceptor interceptor = new ToolExecutionInterceptor(sink, new byte[]{1});

        try {
            interceptor.interceptToolCall(request("call-x", "remoteSearch"), req -> {
                throw new IllegalStateException(
                        ToolStepContract.tagError(ToolStepContract.ErrorCategory.CANCELLED, "已取消"));
            });
        } catch (RuntimeException expected) {
            // 观察者只记录，不吞异常
        }
        assertEquals(ToolStepContract.ErrorCategory.CANCELLED, audit.get(1).errorCategory());
    }

    @Test
    void timeoutTypedExceptionStillCategorizedWithoutATag() {
        assertEquals(ToolStepContract.ErrorCategory.TIMEOUT,
                ToolStepContract.categorize(new TimeoutException("slow"), false));
        assertEquals(ToolStepContract.ErrorCategory.TIMEOUT,
                ToolStepContract.categorize(new IllegalStateException("outer",
                        new TimeoutException("slow")), false));
        assertEquals(ToolStepContract.ErrorCategory.INVALID_OUTPUT,
                ToolStepContract.categorize(new InvalidToolOutputException("bad"), false));
    }

    @Test
    void terminalStateIsPersistedEvenWhenTheEventSubscriberCancelled() {
        // 浏览器断连/用户停止：SSE 订阅被 dispose，管道上的 doOnNext 不再执行。
        // 终态落库挂在 sink 的转移上，因此照样要发生。
        List<MessageDTO> persisted = new CopyOnWriteArrayList<>();
        ToolStepSink sink = new ToolStepSink(THREAD, USER, record -> { }, persisted::add);
        var subscription = sink.events().asFlux().subscribe();
        sink.started("call-c", "searchDocuments", null, null);
        subscription.dispose();

        sink.finished("call-c", "searchDocuments", false, ToolStepContract.ErrorCategory.TIMEOUT);

        assertEquals(1, persisted.size(), "订阅者不在时也必须落库终态");
        assertEquals(ToolStepContract.Status.FAILED.wire(), persisted.get(0).getToolStatus());
        assertEquals("TIMEOUT", persisted.get(0).getErrorCategory());
    }

    @Test
    void aLateResultCannotOverwriteAnAlreadyCancelledStep() {
        // 迟到结果不得二次落库：先 closePending 记 CANCELLED，再来的 finished 必须被忽略。
        List<MessageDTO> persisted = new CopyOnWriteArrayList<>();
        ToolStepSink sink = new ToolStepSink(THREAD, USER, record -> { }, persisted::add);
        sink.events().asFlux().subscribe();
        sink.started("call-late", "searchDocuments", null, null);
        sink.closePending();
        sink.finished("call-late", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE);

        assertEquals(1, persisted.size(), "取消之后不允许再写一条成功终态");
        assertEquals(ToolStepContract.Status.CANCELLED.wire(), persisted.get(0).getToolStatus());
    }

    @Test
    void cancelFromGraphCloseIsAlsoPersisted() {
        List<MessageDTO> persisted = new CopyOnWriteArrayList<>();
        ToolStepSink sink = new ToolStepSink(THREAD, USER, record -> { }, persisted::add);
        sink.events().asFlux().subscribe().dispose();
        sink.started("call-d", "searchDocuments", null, null);
        sink.closePending();

        assertEquals(1, persisted.size());
        assertEquals(ToolStepContract.Status.CANCELLED.wire(), persisted.get(0).getToolStatus());
        assertEquals("CANCELLED", persisted.get(0).getErrorCategory());
    }
}

package com.csust.eyediagnosis.agent.guard;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallHandler;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolInterceptor;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * 一次对话回合内的工具调用预算。
 *
 * <p>为什么需要它：{@code ReactAgent.builder()} 在不显式给 {@code CompileConfig} 时，
 * 框架把图的 {@code recursionLimit} 设成 {@code Integer.MAX_VALUE}
 * （spring-ai-alibaba-agent-framework 1.1.2.2 {@code Builder#buildConfig()}），
 * 也就是说「模型反复调工具」这条路径没有任何步数上限；项目此前也没设置。
 *
 * <p>为什么用错误响应而不是抛异常：超预算时把「不许再调工具」作为工具错误交还给模型，
 * 模型通常据此用已有结果收尾，用户拿到的是一份正常回答；抛异常会走 SSE 的通用
 * 「系统繁忙」分支，把一次可解释的截断伪装成服务故障。
 *
 * <p>作用域：计数器属于实例，实例必须**每次对话回合新建**（{@code DiagnosisAgent#buildAgent}
 * 每次请求都会建），不要做成 Spring 单例，否则预算会跨用户累加。
 */
public class ToolCallBudgetInterceptor extends ToolInterceptor {

    private final int maxToolCalls;
    private final AtomicInteger used = new AtomicInteger();

    public ToolCallBudgetInterceptor(int maxToolCalls) {
        if (maxToolCalls <= 0) {
            throw new IllegalArgumentException("maxToolCalls must be > 0, got " + maxToolCalls);
        }
        this.maxToolCalls = maxToolCalls;
    }

    @Override
    public String getName() {
        return "tool-call-budget";
    }

    @Override
    public ToolCallResponse interceptToolCall(ToolCallRequest request, ToolCallHandler handler) {
        int callNo = used.incrementAndGet();
        if (callNo > maxToolCalls) {
            return ToolCallResponse.error(
                    request != null ? request.getToolCallId() : null,
                    request != null ? request.getToolName() : null,
                    "(limit=" + maxToolCalls + ") 本轮工具调用已达上限，工具不会再执行。"
                            + "请直接基于已经拿到的工具结果作答；如果信息仍不足，"
                            + "就说明还缺什么以及建议用户怎么做，不要再次调用工具。");
        }
        return handler.call(request);
    }

    /** 本轮已尝试的工具调用次数（含被预算拒绝的那些）。 */
    public int used() {
        return used.get();
    }

    public int maxToolCalls() {
        return maxToolCalls;
    }
}

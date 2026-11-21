package com.csust.eyediagnosis.agent.guard;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallHandler;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolInterceptor;

/**
 * 工具失败边界的唯一出口：把逃逸出来的异常转成一次<b>真正的</b>工具错误。
 *
 * <p>为什么需要它（1.1.2.2 的真实行为，读字节码复核过）：
 * {@code AgentToolNode#executeSyncTool} 的两条异常分支并不对称——
 * <pre>
 * catch (ToolExecutionException e) {
 *     String msg = processor.process(e);              // 默认 alwaysThrow=false
 *     return ToolCallResponse.of(id, name, msg);      // status == null → isError() == false
 * }
 * catch (Exception e) {
 *     return ToolCallResponse.error(id, name, e);     // 真正的失败
 * }
 * </pre>
 * 也就是说，方法工具抛出的 {@link org.springframework.ai.tool.execution.ToolExecutionException}
 * 会被当成<b>成功结果</b>交回模型，观察者（{@link com.csust.eyediagnosis.agent.ToolExecutionInterceptor}）
 * 只看得到 {@code isError()==false}，会把一次真实失败记成 success。框架自带的
 * {@code ToolErrorInterceptor} 同样用 {@code ToolCallResponse.of(...)}，救不了这个问题。
 *
 * <p>修法两层，缺一不可：
 * <ol>
 *   <li>{@code ReactAgent.Builder#toolExecutionExceptionProcessor} 配成 alwaysThrow，
 *       让异常真的逃出 {@code executeSyncTool}，而不是在那里被转成字符串；</li>
 *   <li>本拦截器挂在拦截链最外层，把逃逸异常转成 {@link ToolCallResponse#error}，
 *       让模型收到「这次工具失败了」并继续对话——既不伪造成功，也不炸掉整段会话。</li>
 * </ol>
 *
 * <p>顺序要求：本类必须是 {@code interceptors(...)} 列表的<b>第一个</b>
 * （{@code InterceptorChain} 把列表首元素包在最外层），否则异常会穿过观察者之后
 * 才被别的东西吞掉，或者干脆让整个图执行失败。
 */
public final class ToolFailureBoundaryInterceptor extends ToolInterceptor {

    @Override
    public String getName() {
        return "iris-tool-failure-boundary";
    }

    @Override
    public ToolCallResponse interceptToolCall(ToolCallRequest request, ToolCallHandler handler) {
        String id = request != null ? request.getToolCallId() : null;
        String name = request != null ? request.getToolName() : null;
        try {
            return handler.call(request);
        } catch (RuntimeException e) {
            // 只把类型名与原始消息交给模型；堆栈与内部细节留在服务端日志。
            return ToolCallResponse.error(id, name, e);
        }
    }
}

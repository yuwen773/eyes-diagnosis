package com.csust.eyediagnosis.agent.observability;

import com.csust.eyediagnosis.model.dto.agent.ResourceRef;

import java.util.ArrayList;
import java.util.List;

/**
 * 工具执行期间登记结构化资源（目前是知识库检索命中）。
 *
 * <p>为什么用线程内收集而不是改工具返回值：工具对模型必须继续输出可读文本，
 * 把结构化引用塞进返回值会让模型照着 JSON 念。工具执行与
 * {@link ToolExecutionObserver} 的回调在同一个线程、同一个调用栈里，
 * 收集器随调用结束被取走并清空——不会跨请求、跨会话串数据。
 *
 * <p>只有成功完成的调用才带走资源（见观察者的处理）：失败/超时/中断的检索
 * 不应在侧栏留下「证据」。
 */
public final class ToolResourceContext {

    private static final ThreadLocal<List<ResourceRef>> CURRENT = new ThreadLocal<>();

    private ToolResourceContext() {
    }

    /** 工具执行期间登记一条资源；同一次调用的重复 id 只留第一条。 */
    public static void record(ResourceRef ref) {
        if (ref == null || ref.id() == null) {
            return;
        }
        List<ResourceRef> list = CURRENT.get();
        if (list == null) {
            list = new ArrayList<>();
            CURRENT.set(list);
        }
        for (ResourceRef existing : list) {
            if (existing.id().equals(ref.id())) {
                return;
            }
        }
        list.add(ref);
    }

    /** 取走本次调用登记的资源并清空线程局部变量。 */
    public static List<ResourceRef> drain() {
        List<ResourceRef> list = CURRENT.get();
        CURRENT.remove();
        return list == null ? List.of() : List.copyOf(list);
    }
}

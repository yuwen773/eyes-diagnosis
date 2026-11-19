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
 * <p><b>前提</b>：工具必须与拦截器在同一个线程同步执行。当前 {@code ReactAgent}
 * 用的是默认配置（{@code parallelToolExecution=false}、
 * {@code wrapSyncToolsAsAsync=false}），{@code executeSyncTool} 直接调
 * {@code ToolCallback.call()}，满足这个前提。
 *
 * <p><b>前提被破坏时要响</b>：{@link #begin()} 登记执行线程，{@link #record}
 * 发现「有调用正在执行、但当前线程不是执行线程」时直接抛异常——工具以明确的
 * 错误失败，而不是把证据写进一个没人取走的列表、让侧栏安静地少一条来源。
 * 真要开启并行/异步工具执行，得先把它改成显式传递（例如经 ToolContext）。
 *
 * <p>只有成功完成的调用才带走资源（见观察者的处理）：失败/超时/中断的检索
 * 不应在侧栏留下「证据」。
 */
public final class ToolResourceContext {

    private static final ThreadLocal<List<ResourceRef>> CURRENT = new ThreadLocal<>();
    /**
     * 正在执行工具调用的线程。必须在进程级可见：ThreadLocal 在新线程里读不到，
     * 而「工具被调度到别的线程」正是要发现的情况。
     */
    private static final java.util.Set<Long> ACTIVE_THREADS =
            java.util.concurrent.ConcurrentHashMap.newKeySet();

    private ToolResourceContext() {
    }

    /**
     * 拦截器在调用工具前登记本次调用。
     *
     * <p>登记之后，若工具被调度到别的工作线程，{@link #record} 会**当场失败**。
     * 否则那是最坏的一种 bug：工具在新线程里写入一个没人取走的列表，侧栏与审计
     * 安静地少一条证据，调用本身却显示成功。
     */
    public static void begin() {
        CURRENT.remove();
        ACTIVE_THREADS.add(Thread.currentThread().threadId());
    }

    /** 工具执行期间登记一条资源；同一次调用的重复 id 只留第一条。 */
    public static void record(ResourceRef ref) {
        if (ref == null || ref.id() == null) {
            return;
        }
        // 有工具调用正在进行、而当前线程不是任何一次调用的执行线程：工具被调度
        // 到了别处。此时写进去的资源没人取走，必须在工具内部直接失败。
        if (!ACTIVE_THREADS.isEmpty() && !ACTIVE_THREADS.contains(Thread.currentThread().threadId())) {
            throw new IllegalStateException(
                    "证据登记发生在工具调用线程之外（登记线程 " + Thread.currentThread().getName()
                            + "）。并行/异步执行工具时 ThreadLocal 收集会静默丢证据，"
                            + "必须改为显式传递（如 ToolContext）。");
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

    /**
     * 注销本次调用。拦截器在 {@code finally} 里调用它，保证即使抛出
     * {@link Error}（而不是 {@link RuntimeException}）也不会把线程 id 永远留在
     * {@link #ACTIVE_THREADS} 里——那会让此后所有线程的证据登记都被误判。
     */
    public static void end() {
        ACTIVE_THREADS.remove(Thread.currentThread().threadId());
    }

    /** 取走本次调用登记的资源并清空线程局部变量。 */
    public static List<ResourceRef> drain() {
        List<ResourceRef> list = CURRENT.get();
        CURRENT.remove();
        end();
        return list == null ? List.of() : List.copyOf(list);
    }
}

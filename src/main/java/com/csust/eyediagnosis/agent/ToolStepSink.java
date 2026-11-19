package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import com.csust.eyediagnosis.utils.TimeFormats;
import reactor.core.publisher.Sinks;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Per-request bridge between the graph's tool interceptor (which runs on the
 * graph worker threads) and the SSE flux. One instance per chat stream — never
 * shared between users or threads by accident.
 *
 * <p>Status events are derived only from real execution: {@link #started} fires at
 * interception time, and {@link #finished} only after the delegate handler returned
 * (or threw). No event is inferred from TOOL_REQUEST or assistant text.
 *
 * <p>This class owns the pending set so cancellation is race-safe even if the
 * SSE subscriber cancels before the interceptor thread finishes. Only calls that
 * never received a real terminal result are marked CANCELLED.
 *
 * <p><b>锁的边界</b>：状态（pending / started / closed）用 {@code this} 监视器保护，
 * 只在极短的临界区内修改；<b>落库与下发不在状态监视器内</b>——落库是一次数据库往返，
 * 拿它去持锁会把「数据库慢」放大成「整个 sink 卡死」。
 * 落库与下发的顺序由单独的 {@code emissionLock} 保证：先提交、再下发，且不会有帧
 * 排在 complete 之后。
 */
public final class ToolStepSink {

    private final Sinks.Many<MessageDTO> events = Sinks.many().unicast().onBackpressureBuffer();
    private final Consumer<ToolAuditRecord> audit;
    /**
     * 终态落库回调。**挂在这里而不是 SSE 管道上**：浏览器断连/用户停止时
     * 订阅会被取消，挂在管道上的 {@code doOnNext} 就再也不会执行，于是一个
     * 真实发生过的工具调用只在审计表里有记录、历史里没有——刷新后这一步
     * 变成「未确认」，和审计对不上。sink 的转移不依赖订阅者是否存在。
     */
    private final Consumer<MessageDTO> persist;
    private final String sessionId;
    private final Long userId;
    // 状态（pending / started / closed）由 this 监视器保护，临界区极短。
    private final Map<String, String> pending = new HashMap<>();
    private final Set<String> started = new HashSet<>();
    private boolean closed;
    /** 传输已取消（订阅者走了）：此后只保留审计，不再往下游发帧。 */
    private volatile boolean deliveryCancelled;
    /** 落库失败：终态没进历史，客户端必须看见流错误。 */
    private volatile boolean persistenceFailed;
    /** 流已结束（complete 之后）：不再有帧发得出去。 */
    private volatile boolean fluxTerminated;
    /** 帧的顺序与「不得排在 complete 之后」由它保证。 */
    private final Object emissionLock = new Object();
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ToolStepSink.class);

    public ToolStepSink(String sessionId, Long userId, Consumer<ToolAuditRecord> audit) {
        this(sessionId, userId, audit, null);
    }

    public ToolStepSink(String sessionId, Long userId, Consumer<ToolAuditRecord> audit,
                        Consumer<MessageDTO> persist) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.audit = audit;
        this.persist = persist;
    }

    public Sinks.Many<MessageDTO> events() { return events; }

    /** 终态落库失败过（诊断用：流会以错误结束，历史里会标出未提交）。 */
    public boolean persistenceFailed() { return persistenceFailed; }

    /** Emit RUNNING for exactly one tool call. id is the graph's tool-call id. */
    public void started(String toolCallId, String toolName, String argsDigest, String argsKeyNames) {
        ToolAuditRecord record = null;
        synchronized (this) {
            if (closed || !started.add(toolCallId)) return;
            pending.put(toolCallId, toolName);
            if (audit != null) {
                record = ToolAuditRecord.start(sessionId, userId, toolCallId, toolName)
                        .withDigest(argsDigest, argsKeyNames);
            }
        }
        if (record != null) audit.accept(record);
        emit(toolCallId, toolName, ToolStepContract.Status.RUNNING, null, null, null, null);
    }

    /**
     * Emit a terminal state only after the real tool result is known.
     *
     * <p>{@code content} 是真实返回值的脱敏截断版，只随终态下发一次：
     * 前端据此展示工具输出，不需要第二条「tool-response」通道。
     * {@code resources} 只来自成功调用——失败/超时/中断的调用不带走任何证据。
     */
    public void finished(String toolCallId, String toolName, boolean success,
                         ToolStepContract.ErrorCategory errorCategory,
                         List<ResourceRef> resources, String content) {
        ToolStepContract.Status status;
        ToolStepContract.FinishReason reason;
        ToolAuditRecord record = null;
        synchronized (this) {
            if (closed || !pending.containsKey(toolCallId)) return;
            toolName = pending.remove(toolCallId);
            status = success
                    ? ToolStepContract.Status.SUCCEEDED : ToolStepContract.Status.FAILED;
            reason = success
                    ? ToolStepContract.FinishReason.SUCCESS : ToolStepContract.FinishReason.TOOL_ERROR;
            if (audit != null) {
                record = ToolAuditRecord.finish(sessionId, userId, toolCallId, toolName,
                        status, errorCategory);
            }
        }
        if (record != null) audit.accept(record);
        emit(toolCallId, toolName, status, reason, errorCategory,
                success ? resources : null,
                success ? content : null);
    }

    /** 旧签名：只关心成败、不需要正文与资源的调用方使用。 */
    public void finished(String toolCallId, String toolName, boolean success,
                         ToolStepContract.ErrorCategory errorCategory) {
        finished(toolCallId, toolName, success, errorCategory, null, null);
    }

    /**
     * Called once when the graph stream terminates (complete, error or cancel).
     * Marks every call that never received a real result CANCELLED, never SUCCEEDED,
     * then closes the status flux so {@code Flux.merge} can terminate.
     */
    public void closePending() {
        List<Map.Entry<String, String>> waiting;
        synchronized (this) {
            if (closed) return;
            closed = true;
            waiting = new ArrayList<>(pending.entrySet());
            pending.clear();
        }
        for (Map.Entry<String, String> entry : waiting) {
            cancelled(entry.getKey(), entry.getValue());
        }
        synchronized (emissionLock) {
            // 流已经以错误结束（终态落库失败）时不能再 complete：那会得到
            // FAIL_TERMINATED 并把异常抛回调用方。
            if (fluxTerminated) return;
            fluxTerminated = true;
            if (!deliveryCancelled) checkEmission(events.tryEmitComplete());
        }
    }

    private void cancelled(String toolCallId, String toolName) {
        if (audit != null) {
            audit.accept(ToolAuditRecord.finish(sessionId, userId, toolCallId, toolName,
                    ToolStepContract.Status.CANCELLED, ToolStepContract.ErrorCategory.CANCELLED));
        }
        emit(toolCallId, toolName, ToolStepContract.Status.CANCELLED,
                ToolStepContract.FinishReason.STREAM_CLOSED, ToolStepContract.ErrorCategory.CANCELLED,
                null, null);
    }

    /**
     * 先落库、再下发。
     *
     * <p>落库在锁外：它是一次数据库往返，锁内等它会把「数据库慢」放大成
     * 「整个 sink 卡死」——关闭流、后续状态转移都会被拖住。落库本身有界
     * （会话队列的等待上限），失败会变成流错误，不会静默丢帧。
     * 下发在 {@code emissionLock} 内：保证帧序、且不会有帧排在 complete 之后。
     */
    private void emit(String toolCallId, String toolName, ToolStepContract.Status status,
                      ToolStepContract.FinishReason reason, ToolStepContract.ErrorCategory errorCategory,
                      List<ResourceRef> resources, String content) {
        MessageDTO dto = new MessageDTO();
        dto.setMessageType(MessageType.TOOL_RESULT);
        dto.setContent(content == null ? "" : content);
        dto.setToolCallId(toolCallId);
        // 工具名不是患者数据：请求帧本来就带 toolCalls[].name，
        // 结果帧缺了它，历史回放就配不回是哪次调用。
        dto.setToolName(toolName);
        dto.setToolStatus(status.wire());
        dto.setStepLabel(ToolStepContract.stepLabel(toolName));
        dto.setTimestamp(TimeFormats.nowIsoOffset());
        if (reason != null) dto.setFinishReason(reason.wire());
        if (errorCategory != null) dto.setErrorCategory(errorCategory.name());
        if (resources != null && !resources.isEmpty()) dto.setResources(List.copyOf(resources));

        // 先落库、再下发：落库不依赖有没有人在听，断连也留得下终态。
        if (status != ToolStepContract.Status.RUNNING && persist != null) {
            try {
                persist.accept(dto);
            } catch (RuntimeException e) {
                // 原写任务由会话队列保留。没有提交反馈时不发送终态，客户端必须
                // 看见流错误；重读历史会显式尝试恢复，不能静默返回陈旧状态。
                log.warn("Tool terminal persistence failed, errorType={}", e.getClass().getSimpleName());
                persistenceFailed = true;
                synchronized (emissionLock) {
                    if (!deliveryCancelled) checkEmission(events.tryEmitError(
                            new IllegalStateException("Tool terminal history could not be committed")));
                    // 流以错误结束，不再有帧发得出去。deliveryCancelled 只表示
                    // 「订阅者走了」，这两件事不能混成一个开关。
                    fluxTerminated = true;
                }
                return;
            }
        }

        synchronized (emissionLock) {
            if (deliveryCancelled || fluxTerminated) return;
            checkEmission(events.tryEmitNext(dto));
        }
    }

    private void checkEmission(Sinks.EmitResult result) {
        if (result == Sinks.EmitResult.FAIL_CANCELLED) {
            // Cancellation withdraws the transport only; pending calls still get
            // their one audit terminal state when closePending runs.
            deliveryCancelled = true;
            log.debug("Tool status subscriber cancelled; subsequent transitions are audit-only");
            return;
        }
        // 其余（含 FAIL_TERMINATED）都要报出来：流已经结束却还有帧要发，
        // 说明有第二条路径在往同一条流里写——这是缺陷，不能安静地吞掉。
        result.orThrow();
    }

    /** Minimal audit payload. Never contains raw arguments, prompts or patient text. */
    public record ToolAuditRecord(String sessionId, Long userId, String toolCallId, String toolName,
                                  ToolStepContract.Status status, ToolStepContract.ErrorCategory errorCategory,
                                  long atMillis, String argsDigest, String argsKeyNames) {
        static ToolAuditRecord start(String sessionId, Long userId, String id, String name) {
            return new ToolAuditRecord(sessionId, userId, id, name, ToolStepContract.Status.RUNNING,
                    ToolStepContract.ErrorCategory.NONE, System.currentTimeMillis(), null, null);
        }
        static ToolAuditRecord finish(String sessionId, Long userId, String id, String name,
                                      ToolStepContract.Status status, ToolStepContract.ErrorCategory category) {
            return new ToolAuditRecord(sessionId, userId, id, name, status, category,
                    System.currentTimeMillis(), null, null);
        }
        /** Attach the protected digest computed from normalized argument key names. */
        public ToolAuditRecord withDigest(String digest, String keys) {
            return new ToolAuditRecord(sessionId, userId, toolCallId, toolName, status, errorCategory,
                    atMillis, digest, keys);
        }
    }
}

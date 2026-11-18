package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import com.csust.eyediagnosis.utils.TimeFormats;
import reactor.core.publisher.Sinks;

import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.HashSet;
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
 */
public final class ToolStepSink {

    private final Sinks.Many<MessageDTO> events = Sinks.many().unicast().onBackpressureBuffer();
    private final Consumer<ToolAuditRecord> audit;
    private final String sessionId;
    private final Long userId;
    // One monitor owns transitions, audit order and sink emissions together.
    private final Map<String, String> pending = new HashMap<>();
    private final Set<String> started = new HashSet<>();
    private boolean closed;
    private boolean deliveryCancelled;
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ToolStepSink.class);

    public ToolStepSink(String sessionId, Long userId, Consumer<ToolAuditRecord> audit) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.audit = audit;
    }

    public Sinks.Many<MessageDTO> events() { return events; }

    /** Emit RUNNING for exactly one tool call. id is the graph's tool-call id. */
    public synchronized void started(String toolCallId, String toolName, String argsDigest, String argsKeyNames) {
        if (closed || !started.add(toolCallId)) return;
        pending.put(toolCallId, toolName);
        if (audit != null) {
            audit.accept(ToolAuditRecord.start(sessionId, userId, toolCallId, toolName)
                    .withDigest(argsDigest, argsKeyNames));
        }
        emit(toolCallId, toolName, ToolStepContract.Status.RUNNING, null, null);
    }

    /**
     * Emit a terminal state only after the real tool result is known.
     *
     * <p>{@code content} 是真实返回值的脱敏截断版，只随终态下发一次：
     * 前端据此展示工具输出，不需要第二条「tool-response」通道。
     * {@code resources} 只来自成功调用——失败/超时/中断的调用不带走任何证据。
     */
    public synchronized void finished(String toolCallId, String toolName, boolean success,
                         ToolStepContract.ErrorCategory errorCategory,
                         List<ResourceRef> resources, String content) {
        if (closed || !pending.containsKey(toolCallId)) return;
        toolName = pending.remove(toolCallId);
        ToolStepContract.Status status = success
                ? ToolStepContract.Status.SUCCEEDED : ToolStepContract.Status.FAILED;
        ToolStepContract.FinishReason reason = success
                ? ToolStepContract.FinishReason.SUCCESS : ToolStepContract.FinishReason.TOOL_ERROR;
        if (audit != null) {
            audit.accept(ToolAuditRecord.finish(sessionId, userId, toolCallId, toolName,
                    status, errorCategory));
        }
        emit(toolCallId, toolName, status, reason, errorCategory,
                success ? resources : null,
                success ? content : null);
    }

    /** 旧签名：只关心成败、不需要正文与资源的调用方使用。 */
    public synchronized void finished(String toolCallId, String toolName, boolean success,
                         ToolStepContract.ErrorCategory errorCategory) {
        finished(toolCallId, toolName, success, errorCategory, null, null);
    }

    /**
     * Called once when the graph stream terminates (complete, error or cancel).
     * Marks every call that never received a real result CANCELLED, never SUCCEEDED,
     * then closes the status flux so {@code Flux.merge} can terminate.
     */
    public synchronized void closePending() {
        if (closed) return;
        closed = true;
        for (Map.Entry<String, String> entry : pending.entrySet()) {
            cancelled(entry.getKey(), entry.getValue());
        }
        pending.clear();
        if (!deliveryCancelled) checkEmission(events.tryEmitComplete());
    }

    private void cancelled(String toolCallId, String toolName) {
        if (audit != null) {
            audit.accept(ToolAuditRecord.finish(sessionId, userId, toolCallId, toolName,
                    ToolStepContract.Status.CANCELLED, ToolStepContract.ErrorCategory.CANCELLED));
        }
        emit(toolCallId, toolName, ToolStepContract.Status.CANCELLED,
                ToolStepContract.FinishReason.STREAM_CLOSED, ToolStepContract.ErrorCategory.CANCELLED);
    }

    private void emit(String toolCallId, String toolName, ToolStepContract.Status status,
                      ToolStepContract.FinishReason reason, ToolStepContract.ErrorCategory errorCategory) {
        emit(toolCallId, toolName, status, reason, errorCategory, null, null);
    }

    private void emit(String toolCallId, String toolName, ToolStepContract.Status status,
                      ToolStepContract.FinishReason reason, ToolStepContract.ErrorCategory errorCategory,
                      List<ResourceRef> resources, String content) {
        if (deliveryCancelled) return;
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
        checkEmission(events.tryEmitNext(dto));
    }

    private void checkEmission(Sinks.EmitResult result) {
        if (result == Sinks.EmitResult.FAIL_CANCELLED) {
            // Cancellation withdraws the transport only; pending calls still get
            // their one audit terminal state when closePending runs.
            deliveryCancelled = true;
            log.debug("Tool status subscriber cancelled; subsequent transitions are audit-only");
            return;
        }
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
            return new ToolAuditRecord(sessionId, userId, toolCallId, toolName, status,
                    errorCategory, atMillis, digest, keys);
        }
    }
}

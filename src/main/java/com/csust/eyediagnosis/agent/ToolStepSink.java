package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import reactor.core.publisher.Sinks;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
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
    /** tool-call id → tool name. Concurrent because graph tools may run in parallel. */
    private final Map<String, String> pending = new ConcurrentHashMap<>();

    public ToolStepSink(String sessionId, Long userId, Consumer<ToolAuditRecord> audit) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.audit = audit;
    }

    public Sinks.Many<MessageDTO> events() { return events; }

    /** Emit RUNNING for exactly one tool call. id is the graph's tool-call id. */
    public void started(String toolCallId, String toolName, String argsDigest, String argsKeyNames) {
        if (toolCallId != null) pending.put(toolCallId, toolName);
        emit(toolCallId, toolName, ToolStepContract.Status.RUNNING, null, null);
        if (audit != null) {
            audit.accept(ToolAuditRecord.start(sessionId, userId, toolCallId, toolName)
                    .withDigest(argsDigest, argsKeyNames));
        }
    }

    /** Emit a terminal state only after the real tool result is known. */
    public void finished(String toolCallId, String toolName, boolean success,
                         ToolStepContract.ErrorCategory errorCategory) {
        if (toolCallId != null) pending.remove(toolCallId);
        ToolStepContract.Status status = success
                ? ToolStepContract.Status.SUCCEEDED : ToolStepContract.Status.FAILED;
        ToolStepContract.FinishReason reason = success
                ? ToolStepContract.FinishReason.SUCCESS : ToolStepContract.FinishReason.TOOL_ERROR;
        emit(toolCallId, toolName, status, reason, errorCategory);
        if (audit != null) {
            audit.accept(ToolAuditRecord.finish(sessionId, userId, toolCallId, toolName,
                    status, errorCategory));
        }
    }

    /**
     * Called once when the graph stream terminates (complete, error or cancel).
     * Marks every call that never received a real result CANCELLED, never SUCCEEDED,
     * then closes the status flux so {@code Flux.merge} can terminate.
     */
    public void closePending() {
        for (Map.Entry<String, String> entry : pending.entrySet()) {
            cancelled(entry.getKey(), entry.getValue());
        }
        pending.clear();
        events.tryEmitComplete();
    }

    private void cancelled(String toolCallId, String toolName) {
        emit(toolCallId, toolName, ToolStepContract.Status.CANCELLED,
                ToolStepContract.FinishReason.STREAM_CLOSED, ToolStepContract.ErrorCategory.CANCELLED);
        if (audit != null) {
            audit.accept(ToolAuditRecord.finish(sessionId, userId, toolCallId, toolName,
                    ToolStepContract.Status.CANCELLED, ToolStepContract.ErrorCategory.CANCELLED));
        }
    }

    private void emit(String toolCallId, String toolName, ToolStepContract.Status status,
                      ToolStepContract.FinishReason reason, ToolStepContract.ErrorCategory errorCategory) {
        MessageDTO dto = new MessageDTO();
        dto.setMessageType(MessageType.TOOL_RESULT);
        dto.setContent("");
        dto.setToolCallId(toolCallId);
        dto.setToolStatus(status.wire());
        dto.setStepLabel(ToolStepContract.stepLabel(toolName));
        if (reason != null) dto.setFinishReason(reason.wire());
        if (errorCategory != null) dto.setErrorCategory(errorCategory.name());
        events.tryEmitNext(dto);
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

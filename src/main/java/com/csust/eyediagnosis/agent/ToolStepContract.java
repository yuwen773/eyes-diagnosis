package com.csust.eyediagnosis.agent;

import java.util.Map;
import java.util.Set;

/**
 * Ordinary-chat tool step contract. This is deliberately NOT part of the medical
 * collaboration 16-event contract ({@code collaboration/CollaborationEvents.java}).
 *
 * <p>Every value sent to the browser is server-owned and fixed: labels come from a
 * closed whitelist keyed by tool name, never from model text. A step may only become
 * SUCCEEDED after a real tool execution result (see {@link ToolExecutionInterceptor});
 * receiving TOOL_REQUEST or a normal assistant chunk is never evidence of success.
 */
public final class ToolStepContract {

    private ToolStepContract() {}

    /** Fixed state machine: awaiting confirmation → running → terminal. */
    public enum Status {
        AWAITING_CONFIRM("awaiting-confirm"),
        RUNNING("running"),
        SUCCEEDED("succeeded"),
        FAILED("failed"),
        CANCELLED("cancelled");

        private final String wire;

        Status(String wire) { this.wire = wire; }

        public String wire() { return wire; }

        public boolean terminal() {
            return this == SUCCEEDED || this == FAILED || this == CANCELLED;
        }
    }

    /** Why a step stopped. Only a real result may carry SUCCESS; everything else is explicit. */
    public enum FinishReason {
        SUCCESS("STOP"),
        TOOL_ERROR("TOOL_ERROR"),
        STREAM_CLOSED("INTERRUPTED"),
        USER_ABORT("CANCELLED");

        private final String wire;

        FinishReason(String wire) { this.wire = wire; }

        public String wire() { return wire; }
    }

    /** Coarse, non-sensitive error taxonomy for audit records. Never stores raw messages. */
    public enum ErrorCategory {
        NONE, TOOL_EXCEPTION, TIMEOUT, INVALID_OUTPUT, CANCELLED
    }

    /**
     * Closed label whitelist. Unknown / MCP-supplied tool names all collapse to the
     * generic label, so a third-party tool description can never become patient-facing text.
     */
    private static final Map<String, String> LABELS = Map.of(
            "searchDocuments", "检索医学知识库",
            "analyzeEyeImage", "分析眼底图像",
            "userBoundSearchDocuments", "检索医学知识库",
            "userBoundAnalyzeEyeImage", "分析眼底图像");

    private static final String GENERIC_LABEL = "调用工具";
    private static final Set<String> KNOWN_TOOLS = LABELS.keySet();

    public static String stepLabel(String toolName) {
        if (toolName == null) return GENERIC_LABEL;
        return LABELS.getOrDefault(toolName, GENERIC_LABEL);
    }

    /** True when the tool is one we own a fixed label for; MCP tools are still rendered generically. */
    public static boolean isKnown(String toolName) {
        return toolName != null && KNOWN_TOOLS.contains(toolName);
    }

    /**
     * Sanitize an error into a stable category without persisting the message.
     *
     * <p>沿 cause 链走一段再判定：框架把工具异常包成 {@code ToolExecutionException}，
     * 真正的超时/取消原因在里层；只看最外层的类名会把它们统一记成 TOOL_EXCEPTION。
     */
    public static ErrorCategory categorize(Throwable error, boolean interrupted) {
        if (interrupted) return ErrorCategory.CANCELLED;
        if (error == null) return ErrorCategory.NONE;
        Throwable cursor = error;
        boolean invalidOutput = false;
        for (int depth = 0; cursor != null && depth < 8; depth++) {
            if (cursor instanceof java.util.concurrent.TimeoutException) return ErrorCategory.TIMEOUT;
            if (cursor instanceof java.util.concurrent.CancellationException) return ErrorCategory.CANCELLED;
            if (cursor instanceof InterruptedException) return ErrorCategory.CANCELLED;
            // 无效输出同样沿 cause 链认：框架可能把它包一层 ToolExecutionException。
            if (cursor instanceof InvalidToolOutputException || cursor instanceof IllegalArgumentException) {
                invalidOutput = true;
            }
            String type = cursor.getClass().getSimpleName();
            if (type.contains("Timeout")) return ErrorCategory.TIMEOUT;
            if (type.contains("Cancelled") || type.contains("Canceled")) return ErrorCategory.CANCELLED;
            Throwable next = cursor.getCause();
            cursor = next == cursor ? null : next;
        }
        return invalidOutput ? ErrorCategory.INVALID_OUTPUT : ErrorCategory.TOOL_EXCEPTION;
    }
}

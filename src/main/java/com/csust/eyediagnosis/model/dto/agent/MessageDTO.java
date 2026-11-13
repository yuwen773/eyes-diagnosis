package com.csust.eyediagnosis.model.dto.agent;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;
import java.util.List;
import java.util.Map;

/**
 * Omit absent fields so ordinary-chat SSE frames stay byte-compatible with the
 * pre-A1 shape (no new null keys) for existing clients and fixtures.
 */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class MessageDTO {
    private String content;
    private MessageType messageType;
    private List<Map<String, Object>> toolCalls;

    /* ── Ordinary-chat tool step contract (all optional) ──────────────────
     * Absent on historical messages, plain assistant chunks and every event
     * emitted before this feature: consumers must tolerate null. No new SSE
     * event name is introduced; these ride on existing MessageDTO frames.
     * Never populated from model-generated text — see ToolStepContract.
     * ──────────────────────────────────────────────────────────────────── */
    /** Exact correlation key for one tool invocation; prevents concurrent cards from cross-talking. */
    private String toolCallId;
    /** ToolStepContract.Status wire value. */
    private String toolStatus;
    /** Fixed whitelist label derived from the tool name. */
    private String stepLabel;
    /** ToolStepContract.FinishReason wire value; only real results carry STOP. */
    private String finishReason;
    /** Coarse audit category (ToolStepContract.ErrorCategory), never a raw message. */
    private String errorCategory;
}

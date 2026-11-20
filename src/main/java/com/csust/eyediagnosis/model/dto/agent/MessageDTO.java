package com.csust.eyediagnosis.model.dto.agent;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;
import java.util.List;
import java.util.Map;

/**
 * Ordinary-chat SSE omits every null field, including the legacy content,
 * messageType and toolCalls fields. Consumers must accept missing fields;
 * this is structural compatibility, not byte-for-byte compatibility with pre-A1 frames.
 *
 * <p>工具生命周期用 {@code toolCallId} 关联；状态词表由
 * {@link com.csust.eyediagnosis.agent.ToolStepContract} 单点定义
 * （running / succeeded / failed / cancelled / awaiting-confirm），
 * 没有观察依据时不要填 succeeded。{@code timestamp} 带时区偏移，
 * 展示层按浏览器本地时区换算。
 */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class MessageDTO {
    private String content;
    private MessageType messageType;
    private List<Map<String, Object>> toolCalls;

    /* -- Ordinary-chat tool step contract (all optional) ------------------
     * Absent on historical messages, plain assistant chunks and every event
     * emitted before this feature: consumers must tolerate missing or null fields. No new SSE
     * event name is introduced; these ride on existing MessageDTO frames.
     * Never populated from model-generated text - see ToolStepContract.
     * -------------------------------------------------------------------- */
    /** Exact correlation key for one tool invocation; prevents concurrent cards from cross-talking. */
    private String toolCallId;
    /** ToolStepContract.Status wire value. */
    private String toolStatus;
    /** 服务端固定工具名（与请求帧 toolCalls[].name 同源），用于历史回放配对。 */
    private String toolName;
    /** Fixed whitelist label derived from the tool name. */
    private String stepLabel;
    /** ToolStepContract.FinishReason wire value; only real results carry STOP. */
    private String finishReason;
    /** Coarse audit category (ToolStepContract.ErrorCategory), never a raw message. */
    private String errorCategory;
    /** 带时区偏移的 ISO-8601 时间点，展示层按浏览器本地时区换算。 */
    private String timestamp;
    /**
     * 本次工具调用产生的结构化资源（目前是知识库检索命中的文档）。
     * 只挂在真实成功的 tool-result 上；失败/超时/中断的调用不带资源，
     * 侧栏不拿它当证据。
     */
    private List<ResourceRef> resources;
}

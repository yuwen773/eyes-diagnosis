package com.csust.eyediagnosis.model.dto.agent;

import lombok.Data;
import java.util.List;
import java.util.Map;

/**
 * SSE 单片事件。
 *
 * <p>工具生命周期用 {@code toolCallId} 关联；{@code status} 只陈述观察到的
 * 事实（success / error / timeout / cancelled / completed / unknown），
 * 没有观察依据时不要填 success。
 */
@Data
public class MessageDTO {
    private String content;
    private MessageType messageType;
    private List<Map<String, Object>> toolCalls;

    /** 工具调用/结果：模型或框架给出的稳定关联键。 */
    private String toolCallId;
    /** 工具调用/结果：函数名（searchDocuments 等）。 */
    private String toolName;
    /**
     * 工具结果状态：
     * <ul>
     *   <li>{@code success} / {@code error} / {@code timeout} / {@code cancelled}
     *       ——由 ToolInterceptor 观察到的真实结果；</li>
     *   <li>{@code completed} ——框架确实返回了结果，但没有观察到成败；</li>
     *   <li>{@code unknown} ——流结束时仍未收到结果。</li>
     * </ul>
     */
    private String status;
    /** 带时区偏移的 ISO-8601 时间点，展示层按浏览器本地时区换算。 */
    private String timestamp;
}

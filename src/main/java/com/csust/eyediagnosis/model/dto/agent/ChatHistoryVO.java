package com.csust.eyediagnosis.model.dto.agent;

import lombok.AllArgsConstructor;
import lombok.Data;
import java.util.List;

@Data
@AllArgsConstructor
public class ChatHistoryVO {
    private List<MessageVO> messages;
    private boolean hasMore;
    private Long nextCursor;
    /**
     * 本会话存在未提交的消息终态（写入失败或待恢复）。
     *
     * <p>历史本身照常返回——读得着的消息不让读不着的那条拖垮整次读取；
     * 但历史**不完整**，必须显式告诉前端，不能让界面把陈旧历史当成完整历史。
     */
    private boolean uncommittedTerminal;
}

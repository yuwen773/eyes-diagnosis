package com.csust.eyediagnosis.ai.model.message;

import com.csust.eyediagnosis.ai.model.enums.StreamMessageTypeEnum;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * @ ClassName AiResponseMessage
 * @ Description ai主体回复
 * @ Author 钰玟
 * @ Date 2025/9/19 下午3:59
 * Version 1.0
 **/
@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class AiResponseMessage extends StreamMessage {
    /**
     * 消息内容
     */
    private String content;

    public AiResponseMessage(String content) {
        super(StreamMessageTypeEnum.AI_RESPONSE.getValue());
        this.content = content;
    }
}

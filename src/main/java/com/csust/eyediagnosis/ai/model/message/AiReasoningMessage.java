package com.csust.eyediagnosis.ai.model.message;

import com.csust.eyediagnosis.ai.model.enums.StreamMessageTypeEnum;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * @ ClassName AiReasoningMessage
 * @ Description ai思考
 * @ Author 钰玟
 * @ Date 2025/9/19 下午4:00
 * Version 1.0
 **/
@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class AiReasoningMessage extends StreamMessage{
    private String content;
    public AiReasoningMessage(String content) {
        super(StreamMessageTypeEnum.AI_REASONING.getValue());
        this.content = content;
    }
}

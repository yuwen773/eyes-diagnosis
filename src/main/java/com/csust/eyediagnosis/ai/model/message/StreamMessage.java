package com.csust.eyediagnosis.ai.model.message;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * @ ClassName StreamMessage
 * @ Description 【基类】 流式消息
 * @ Author 钰玟
 * @ Date 2025/9/19 下午3:57
 * Version 1.0
 **/
@Data
@NoArgsConstructor
@AllArgsConstructor
public class StreamMessage {
    private String type;
}

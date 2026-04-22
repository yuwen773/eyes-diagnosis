package com.csust.eyediagnosis.model.dto.agent;

public enum MessageType {
    ASSISTANT,      // 普通助手回复
    USER,           // 用户消息
    TOOL_REQUEST,   // 工具调用请求
    TOOL_RESULT,    // 工具返回结果
    TOOL_CONFIRM,   // 工具执行确认
    REASONING       // 推理过程
}
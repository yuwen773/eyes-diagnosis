package com.csust.eyediagnosis.model.dto.agent;

import lombok.Data;
import java.util.List;
import java.util.Map;

@Data
public class MessageDTO {
    private String content;
    private MessageType messageType;
    private List<Map<String, Object>> toolCalls;
}
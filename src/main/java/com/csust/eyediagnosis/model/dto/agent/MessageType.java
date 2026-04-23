package com.csust.eyediagnosis.model.dto.agent;

import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum MessageType {
    ASSISTANT("assistant"),
    USER("user"),
    TOOL_REQUEST("tool-request"),
    TOOL_RESULT("tool-result"),
    TOOL_CONFIRM("tool-confirm"),
    REASONING("reasoning");

    private final String value;

    MessageType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }
}
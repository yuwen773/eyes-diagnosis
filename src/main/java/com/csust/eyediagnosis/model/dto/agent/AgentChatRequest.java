package com.csust.eyediagnosis.model.dto.agent;

import lombok.Data;
import java.io.Serializable;
import java.util.List;

@Data
public class AgentChatRequest implements Serializable {
    private String message;
    private String threadId;
    private Long userId;
    private List<String> imageUrls;
    private List<String> enabledMcpServers;
    private Boolean disableMcpDefault;
}
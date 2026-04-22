package com.csust.eyediagnosis.agent.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "agent")
public class AgentConstants {
    private int maxHistoryPageSize = 100;
    private int maxIterations = 10;
    private int modelCallLimit = 15;
    private int historyTruncateLength = 500;
    private int historyTruncateReserve = 200;
}
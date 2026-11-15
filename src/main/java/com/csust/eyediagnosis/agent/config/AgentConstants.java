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
    /**
     * 是否把上游模型的 reasoning 作为消息展示并落库。
     * 默认关闭：未筛选的推理材料既不是产品事实，也不应进入患者侧历史。
     */
    private boolean exposeReasoning = false;
}
package com.csust.eyediagnosis.agent.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "agent")
public class AgentConstants {
    private int maxHistoryPageSize = 100;
    /**
     * 单次对话回合允许的工具调用次数（{@code ToolCallBudgetInterceptor}）。
     * 超出后工具不再执行，改为把错误交还模型，要求它用已有结果收尾。
     */
    private int maxIterations = 10;
    /**
     * 单次对话回合允许的模型调用次数预算。
     * 图执行的硬上限按 {@code modelCallLimit * 2 + 2} 折算成递归步数
     * （{@code DiagnosisAgent#guardedCompileConfig}），一个 ReAct 回合内模型节点与工具节点各占一步。
     */
    private int modelCallLimit = 15;
    private int historyTruncateLength = 500;
    private int historyTruncateReserve = 200;
    /**
     * 是否把上游模型的 reasoning 作为消息展示并落库。
     * 默认关闭：未筛选的推理材料既不是产品事实，也不应进入患者侧历史。
     */
    private boolean exposeReasoning = false;
}

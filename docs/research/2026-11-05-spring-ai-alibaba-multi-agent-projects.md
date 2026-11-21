# Spring AI Alibaba 多智能体项目调研

调研日期：2026-11-05。目标：为 Eyes Diagnosis 的 Java 诊断编排与聊天 Agent 找可查证的参考实现。当前项目锁定 Spring AI 1.1.2、Spring AI Alibaba 1.1.2.2。以下为源码和项目文档的静态调查，**没有运行项目，也没有验证临床有效性、生产安全或跨进程恢复**。

## 推荐阅读

### 1. 官方 RAG Workflow（版本完全对齐的图示例）

- [1.1.2.2 固定提交 RagAgentConfig.java](https://github.com/alibaba/spring-ai-alibaba/blob/7405a7dc0d66d582ec79430af6e24d259d5ca6ea/examples/multiagent-patterns/workflow/src/main/java/com/alibaba/cloud/ai/examples/multiagents/workflow/ragagent/RagAgentConfig.java)：用 `StateGraph`、`ReplaceStrategy` 与 `AppendStrategy` 将 rewrite、retrieve、prepare、`ReactAgent.asNode()` 串起来；[配套说明](https://github.com/alibaba/spring-ai-alibaba/blob/v1.1.2.2/examples/multiagent-patterns/workflow/README.md)列出查询改写、确定性检索、准备上下文与回复。
- **借鉴**：确定性检索和模型节点的职责划分、图状态合并及 Agent 节点适配；适合小图 PoC。该例是单个 ReactAgent + 多个处理节点，不能以节点数声称自治多 Agent。
- **边界**：源码使用内存 `SimpleVectorStore` 和演示数据，直接 `graph.compile()`；不证明与业务事务原子提交、跨进程恢复、受控临床证据或患者授权。

### 2. 官方 Supervisor（多个真正 Agent 的协调）

- [1.1.2.2 固定提交 SupervisorConfig.java](https://github.com/alibaba/spring-ai-alibaba/blob/7405a7dc0d66d582ec79430af6e24d259d5ca6ea/examples/multiagent-patterns/supervisor/src/main/java/com/alibaba/cloud/ai/examples/multiagents/supervisor/SupervisorConfig.java)：两个专用 `ReactAgent`（日历、邮件）通过 `AgentTool.getFunctionToolCallback` 包装供上层 `ReactAgent` 调用；上层使用 `MemorySaver`。[配套说明](https://github.com/alibaba/spring-ai-alibaba/blob/v1.1.2.2/examples/multiagent-patterns/supervisor/README.md)明确外部服务为 stub。
- **借鉴**：职责提示词隔离、受限工具集合、Agent 作为工具的输入输出与协调边界。可用于对话中确需专业子任务时的小型对照。
- **边界**：模型决定调度，不能直接承载医疗风险判定、医生复核或保存授权；内存 Saver 不证明持久恢复，更不证明正式业务写操作已授权。

### 3. 官方 Handoffs（基于状态的角色交接）

- [1.1.2.2 固定标签说明](https://github.com/alibaba/spring-ai-alibaba/blob/v1.1.2.2/examples/multiagent-patterns/handoffs-multiagent/README.md)：销售和客服各是 Graph 节点内的 ReactAgent；交接工具更新 `active_agent`，父图条件边按状态路由，工具使用 `returnDirect=true`。
- **借鉴**：明确下一处理角色及上下文交接。用来比较静态路由与动态 Agent 决策，而非要求诊断路径采用同样的模型自主交接。
- **边界**：示例的对话上下文透传和路由能力不等同于医生鉴权、状态 CAS、临床审批或数据最小化；需自行定义。

### 4. SunnySide（医疗方向应用，但不是已证实的多 Agent）

- [项目说明](https://github.com/6666ccc/SunnySide-)描述医疗陪护方向的 RAG、工具、多轮会话与 SSE；[固定提交 AIChat.java](https://github.com/6666ccc/SunnySide-/blob/513e032c1b9bc5087bf557461105e4674c2c697d/src/main/java/com/example/project/ai/client/AIChat.java)实际展示 `ChatClient`、检索与记忆 Advisor、业务工具和流式回复。
- [该提交 pom.xml](https://github.com/6666ccc/SunnySide-/blob/513e032c1b9bc5087bf557461105e4674c2c697d/pom.xml)配置 Spring AI 1.1.4、Spring AI Alibaba 1.1.2.0，**不与本项目完全一致**。仅凭上述代码不能把它认定为多 Agent；适合参考医疗业务工具和会话整合。
- **边界**：未验证工作流实现是否仍与 README 所述一致；未验证安全、权限、数据真实性、临床效果或迁移兼容性。

### 5. 官方生态饮品店多 Agent（分布式应用）

- [固定提交 SupervisorAgent.java](https://github.com/spring-ai-alibaba/spring-ai-alibaba-multi-agent-demo/blob/7465beb2ef628aa467f03a13168c10aca882699c/supervisor-agent/src/main/java/com/alibaba/cloud/ai/demo/config/SupervisorAgent.java) 构造 `LlmRoutingAgent`，通过 AgentCardProvider 和 `A2aRemoteAgent` 接入咨询、反馈、订单三类子 Agent；[项目 pom.xml](https://github.com/spring-ai-alibaba/spring-ai-alibaba-multi-agent-demo/blob/7465beb2ef628aa467f03a13168c10aca882699c/pom.xml) 使用 Spring AI Alibaba **1.0.0.4**，并列出多个子 Agent/MCP 服务模块。
- **借鉴**：真实多服务例子的职责拆分、Agent 描述及远程调用边界，适合评估将来是否确需跨服务 Agent。
- **边界**：旧版本、额外远程调用及基础设施复杂度均不适合直接照搬；不能推断其具备医疗事务、安全或临床验证。

## 建议决策

先按 1→2→4 的顺序读源码：用官方 RAG 图验证节点和工具组合；用 Supervisor 验证确有需要时如何隔离子 Agent；医疗示例仅参考业务接口。并行比较领域状态机与 Graph 时，保持同一业务规则、同一调度器和故障注入集，避免将编排与任务执行两个变量混在一起。模型调用、Graph checkpoint 或普通 RAG 都不能替代业务权限、冻结证据复验、患者授权及幂等事务。

未执行外部仓库代码、Maven 构建、真实模型调用、Graph PoC 或医疗验收；兼容性必须在当前锁定依赖上独立测试。

# TASK-02：Graph 执行归属、检查点与恢复

2026-11-11。Spring AI Alibaba Graph `1.1.2.2`，复用 TASK-03 的 DTO v1 与事件出口；专项证据见 [验收报告](testing/2026-11-11-realtime-graph-runtime.md)。正式 React 契约已允许 `runtimeKind=GRAPH` 和字符串 workflowVersion，本卡不修改前端协议。

## 开关与版本

`eye-diagnosis.collaboration.enabled` 及游标密钥要求继续生效。新增 `eye-diagnosis.collaboration.graph-enabled` 默认 `false`；显式开启后，仅新受理的协作 run 固化 `GRAPH / GRAPH_V1`，否则为 `COORDINATOR / AUTONOMOUS_V2`。客户端不能选择运行时。幂等重放沿用已有运行归属，不读取当前开关重新分配。

Graph 使用真实并行 Vision/Evidence、汇合、Explanation、Critic 条件边；SUPPLEMENT 有独立回边，REWRITE 不重跑 Vision/Evidence。底层角色信封与内部草稿 workflow 仍为 `AUTONOMOUS_V2`：Graph 改变调度方式，保留既有消息语义。节点返回结构化结果，不提供 token 流、像素级视觉能力或医生批准权限。

关闭 graph-enabled 后，已受理的 Graph run 继续由其兼容适配器完成/恢复；新的 Coordinator run 不会接管它们。关闭整个 collaboration 功能或回退二进制之前，仍须先排空或持久取消全部活动 run，保持兼容 worker 到排空结束。

## 恢复权威

Java 线仅追加 V19，不改 V10–18，不处理 master/Java 重号或缺失 V15。生产应用前须完成原有历史兼容专项。

`t_patient_graph_execution` 与现有 task/draft/run 共用同一数据库。每次领取生成随机 leaseOwner，fencingToken 加一，租约 10 秒；活动执行器每秒续租。领取、派发登记、模型开始、审计结果、验证后提交、检查点和终态均在 task → draft 的锁序内检查当前租约/令牌；治理来源使用既有来源锁序。检查使用当前锁定读，过期持有者不能续租复活或写入停止原因。其他进程只能接管已到期租约。

每个合法逻辑节点以 `角色:版本` 写入 `t_patient_graph_node`；同事务完成来源/草稿/反馈校验、版本写入、真实事件和 checkpointJson/checkpointVersion 更新。检查点包含当前证据、草稿、反馈及定向信封，严格留在内部表。条件更新检查期望 checkpointVersion，避免覆盖新提交；失败则全部回滚。

应用提交日志是唯一恢复权威。恢复时重建相同版本的真实 Graph，从 START 重走调度，已提交节点只返回其持久 statePatch，不调用提供方、不重发事件；未提交节点才重新派发。框架 MemorySaver 不参与生产恢复，因此不存在独立于领域事务的第二份成功检查点。这不是提供方调用的 exactly-once 保证。

总截止时间、模型调用次数及反馈次数均沿用原表，不因接管重置。模型调用登记先持久消耗预算；崩溃中未提交的调用可能已经计费，恢复重试再次消耗原有最多 8 次调用预算。角色 20 秒、总计 90 秒及一次反馈上限不变，不添加隐藏 SDK 重试。已提交节点必须复用；预算用尽或截止时间到期直接停止。来源撤回或推理摘要变化在恢复/使用前拒绝。

取消先持久提交，后续角色、检查点、草稿及复核终态写入都通过同一锁序拒绝。关闭 SSE 仍不取消执行。订阅、刷新、幂等受理及终态重放均不重复执行 Graph。迟到提供方仍可能完成和计费，其结果没有提交权限。

## 安全与回退

四角色继续复用 `DraftAgents`、`DraftMailbox` 及 Coordinator 的影像绑定、OOD/拒识、精确引用、证据冻结、定位异议、反馈预算和终态来源复验。患者事件仍只有安全状态与元数据，内部 checkpoint、信封正文、引用、模型上下文及草稿不会新增到 DTO。`SUCCEEDED` 对应待医生复核，不是发布许可。

开发默认值尚不是生产 SLO。生产容量、持久数据保留、二进制回滚和真实 Redis/模型/正常医学输入仍需后续独立验收。V19 表保留以供恢复和审计，不以删表或回退 Flyway 历史实现回滚。

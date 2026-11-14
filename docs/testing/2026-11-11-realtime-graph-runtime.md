# TASK-02：Graph 执行器等价性与恢复验收

2026-11-11。**TASK-02 后端工程专项 PASS；实时多 Agent 整体验收保持 PARTIAL。** 实际使用 Spring AI Alibaba Graph `1.1.2.2`、真实 MySQL 事务和跨 JVM 子进程；模型响应为确定性替身，真实提供方调用 **0**。不据此放行真实模型质量、医学输入、医生发布或生产迁移。

## 候选与输入隔离

- 工作树：`D:/Work/code/eye-diagnosis/.claude/worktrees/realtime-graph-runtime`；分支 `codex/realtime-graph-runtime`。
- 基线：`6572743169027bb1e7c27d7d969a26ed89d99cd1`。候选尚未提交、暂存、推送或部署；验收对象是该基线加文件内容，不是仅该提交。
- 从 TASK-03 独立树复制其 18 个未提交候选文件，作为事件/API/取消基线；从 TASK-01 复制隔离 Graph 测试、ADR 和能力证据。原样复制实施计划 v1.1，不复制原工作区的 OOD、V15 或其他修改，不引入 TASK-04/05 的前端候选。
- 开工清单 [inputs.json](realtime-graph-runtime-20261111/inputs.json) 绑定五个输入工作树的路径集合与 SHA-256；最终 [results.json](realtime-graph-runtime-20261111/results.json) 绑定实际候选、XML 及逐用例结果。
- 结束核对：原工作区 34、TASK-01 7、TASK-03 18、TASK-04 186、TASK-05 229 个文件及路径集合均未变，五者暂存区仍为空。未刷新远端引用。

## 交付与决策

`DraftGraph` 使用真实并行汇合与条件路由；角色适配复用 `DraftAgents`、`DraftMailbox` 和 Coordinator 的同一套输入/引用/证据/版本/预算守卫及领域事件出口。Graph 只调度，无发布或保存权限，不改前端 DTO v1。

新增默认关闭的 `eye-diagnosis.collaboration.graph-enabled`，只影响新 run 的 `runtimeKind/workflowVersion`。既有 Graph run 在关闭该开关后仍由兼容适配器处理；Coordinator run 不会被重新分配。内部信封保留原 `AUTONOMOUS_V2` 领域语义，Graph 调度版本为 `GRAPH_V1`。

Java 线追加 V19 的租约/检查点和逻辑节点提交表。10 秒租约、每秒续租、递增 fencingToken 和期望 checkpointVersion 保护模型开始、审计、合法结果、检查点、事件及终态写入。检查点与节点/领域版本/真实事件在同事务提交；失败全部回滚。治理来源沿用既有来源锁序，租约校验使用当前锁定读。

恢复以应用事务日志为唯一权威，重建相同真实 Graph 后，已提交节点只返回已存 statePatch，既不调用模型也不重复公开事件。没有另设框架 saver 形成独立恢复事实。未提交的在途调用允许在原预算内重试，原调用登记和总截止时间不重置；外部调用可能已计费，不承诺 exactly-once。详见 [执行契约](../graph-execution.md) 和 [ADR](../architecture/multi-agent-adr.md)。

## 本轮验证

环境：PowerShell 7.6.9、指定 Corretto JDK 21.0.7、Maven 3.9.9。MySQL 8.0.26 是本卡 target 下新初始化的独立 loopback 实例，使用三份隔离 schema 和测试专用账号。没有修改原有 MySQL 服务、临床库、Redis、COS、Python 或其他工作树服务。故障注入所需触发器设置仅用于该临时实例。

设置 `GRAPH_EXECUTION_TEST_URL`、`COLLABORATION_TEST_URL`、`ISSUE19_TEST_URL`，分别指向严格限定的 `graph_execution_test`、`collaboration_test`、`issue19_test` 后，在本卡根目录执行：

```text
mvn -o -B -Dtest=GraphExecutionTest,CollaborationRunTest,PatientDraftTest,RealtimeGraphSpikeTest,CoordinationPocTest test
```

最终完整运行于 **2026-11-11 21:02:25 +08:00** 完成，BUILD SUCCESS：

| 套件 | tests | failures | errors | skipped |
| --- | ---: | ---: | ---: | ---: |
| GraphExecutionTest | 32 | 0 | 0 | 0 |
| 原 CollaborationRunTest | 22 | 0 | 0 | 0 |
| 原 PatientDraftTest | 41 | 0 | 0 | 0 |
| 原 RealtimeGraphSpikeTest | 12 | 0 | 0 | 0 |
| 原 CoordinationPocTest | 4 | 0 | 0 | 0 |
| 合计 | **111** | **0** | **0** | **0** |

原始本地日志为 `target/task02-tests.log`，XML 在 `target/surefire-reports/`。结果清单保留 XML 哈希和每个参数用例名；本报告不收录原始内部模型正文或连接凭据。

| 验收能力 | 实际证据 |
| --- | --- |
| NONE / REWRITE / SUPPLEMENT 等价性 | `sameInputsMatchCoordinatorVersionsMessagesBudgetAndPublicFacts`，3 例：比较调用/反馈预算、全部证据来源身份与内容、草稿版本、角色集合、投影事实、收件人/版本/因果引用；独立检索的 retrievedAt 不要求相等 |
| 并行与真实增量 | `evidenceIsVisibleWhileVisionBlocksAndExplanationWaitsForBoth`：Vision 仍在途时 Evidence 已完成，Explanation 尚未派发；不是终态动画 |
| 精确引用/异议/来源/提供方负例 | `safetyAndProviderFailuresMatchCoordinator`，9 例：INVALID_CITATION、INVALID_OBJECTION、INVALID_OUTPUT、PROVIDER_AUTH/RATE_LIMIT/UNAVAILABLE、FEEDBACK_LIMIT、INSUFFICIENT_EVIDENCE、SOURCE_INVALIDATED，逐项与旧执行器对照 |
| 输入受限与绑定变化 | `rejectedInferenceAndChangedBindingNeverCallProviders`，无模型调用，无复核提交 |
| 超时及调用预算 | `timeoutAndCallBudgetsMatchCoordinator`，3 例：AGENT_TIMEOUT、TOTAL_TIMEOUT、CALL_BUDGET；预算不超原上限 |
| 持久取消及最终提交竞态 | `persistentCancelRejectsLateProvidersAndNeverSubmitsReview`、`cancellationAtFinalCriticCannotCommitReviewReady`、`cancellingQueuedGraphRunCallsNoProviderAfterRestart`；忽略中断的模型返回也不能追加事实或复核终态 |
| 过期接管与旧写拒绝 | `expiryTakeoverFencesOldProviderAndReusesCommittedEvidence`：新 token 接管后复用已提交 Evidence，旧 Vision 迟到返回不能覆盖成功终态/水位 |
| 续租与并发领取 | `heartbeatRenewsLeaseAndConcurrentClaimDoesNotDispatchProviders`：续租可观测，其他实例不能抢活租约 |
| 跨 JVM 强杀及恢复 | `processDeathRestoresOnlyCommittedNodesAndPreservesBudgets`，8 例：汇合、草稿、REWRITE/SUPPLEMENT 反馈边界强杀；另含恢复前来源撤回、预算耗尽、总时限到期、推理摘要变化。新 JVM 不重复已提交节点；正常反馈恢复保留 8 次总调用上限；四个负例恢复后不调用模型 |
| 原子检查点 | `checkpointCommitFailureRollsBackEvidenceAndItsPublicFactsTogether`：数据库触发器在逻辑节点写入时失败，证据冻结和公开完成事实同时回滚 |
| 固定归属与读取无副作用 | `closingNewGraphAdmissionDoesNotReassignAnExistingRunAndReplayDoesNotExecute`：关闭新 Graph 受理后既有 run 仍属 Graph；重复执行/读取/重放不增加调用 |

额外检查：

- `python -m unittest discover -s scripts/tests -p test_check_surefire_skips.py`：**20/20 PASS**，含 Graph 专项缺报、跳过和丢用例负例。
- `check_surefire_skips.py target/surefire-reports graph-execution`、`collaboration`、`issue19`：PASS，32/22/41 均无跳过。
- steering docs、设计文档、概率刻度、`git diff --check`：PASS。
- `python scripts/check_task02_inputs.py`：五个输入树哈希/路径集合及空暂存区检查 PASS。
- 新增 MySQL CI job 及显式 opt-in/零跳过门禁，未触发 hosted CI。

## 验证中修正与证据边界

1. 首次编译发现 Jackson 转换异构记录的泛型推断问题，改为按信封类型显式转换；没有放宽结构化角色解析。
2. 临时 MySQL 的短参数经 PowerShell 解析导致启动检查/建测试账号失败；改独立脚本及长参数并确认实例可连。首轮连接失败不计入通过。
3. 三个正常对照最初误比较不同执行的检索时间；保留完整来源、治理版本和内容比较，仅移除 retrievedAt。最终增加收件人/因果引用对照断言并再次运行全部 111 项。
4. 事务故障注入首次因临时 MySQL 的触发器权限失败；只为本卡临时实例和对应 CI 一次性服务启用注入条件，没有修改应用数据库权限或生产设置。

| 未放行项 | 当前状态 |
| --- | --- |
| 真实提供方引用与自主反馈质量、成本/预注册扩大对照 | NOT_RUN，真实调用 0；继续 TASK-06 |
| 正常医学图像、合格 OOD artifact、真实算法/COS/Redis | NOT_RUN，不复用历史证据升级结论 |
| Graph 浏览器 HTTP/SSE、完整 UI 授权影像/引用正文/空会话、医生发布/患者保存 | NOT_RUN；TASK-05 已有证据保留其原边界，本卡只读核对 React 类型契约；继续相应契约补齐及 TASK-07 |
| 生产 Flyway 历史、空库用户引导、Java/master V15–17 分歧 | 未解决；本卡测试应用真实 V19 DDL，不宣称完整 Flyway 升级或生产迁移通过 |
| 全量后端、hosted CI、跨主机实网恢复、性能/SLO、二进制回滚演练 | NOT_RUN；仅上述明确专项有效 |

回退：关闭 graph-enabled 停止新 Graph 受理，既有 Graph run 由兼容 worker 完成或显式持久取消；排空后才能关闭整个协作功能或回退旧二进制。保留 V19 与全部事实/审核历史。最终 Graph 开关仍默认关闭，临时 MySQL 已关闭；没有模型提供方调用、部署或生产回滚操作。

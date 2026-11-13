# TASK-01：实时四角色 Graph 能力验证

日期：2026-11-11。结论：TASK-01 隔离能力验证完成，结果为 PASS_WITH_LIMITATIONS；M0 整体仍为 PARTIAL，Graph 正式迁移尚未验收。

## 输入、范围与候选

- 实施基线：[计划 v1.1](../plans/EyesDiagnosis_RealTime_MultiAgent_Implementation_Plan_v1.1.md)，原文 SHA-256 为 `CD3B1BCD51FED7EFB6479DBF6AB38B04584A7AC194C06DFC9392676CBE8990BB`。本分支携带该文档的原样副本。
- 隔离分支：`codex/realtime-graph-spike`；基于 `6572743169027bb1e7c27d7d969a26ed89d99cd1`。尚未提交，候选代码以 [结果清单](realtime-graph-spike-20261111/results.json) 中的 sourceFileSha256 绑定，不能把基线提交称作已含本次改动。
- 框架：Spring AI `1.1.2`、Spring AI Alibaba agent-framework / graph-core `1.1.2.2`。POM、生产源码、迁移、前端和默认开关均未修改。
- 证据类型：真实 Graph 运行时 + 确定性模型响应替身；没有临床数据、真实模型请求、MySQL 或浏览器参与。

实现文件：测试夹具 [FourRoleGraph.java](../../src/test/java/com/csust/eyediagnosis/poc/realtime/FourRoleGraph.java)、专项 [RealtimeGraphSpikeTest.java](../../src/test/java/com/csust/eyediagnosis/poc/realtime/RealtimeGraphSpikeTest.java)、跨进程恢复 [GraphSpikeResumeWorker.java](../../src/test/java/com/csust/eyediagnosis/poc/realtime/GraphSpikeResumeWorker.java)。均在 test 源集，未注册 Spring bean。

## 能力矩阵

| 能力 | 测试与实际观察 | 判定及边界 |
| --- | --- | --- |
| 并行与汇合 | `parallelBranchesJoinBeforeExplanationWithoutLosingState`：双屏障证明 Vision/Evidence 重叠；Explanation 获得两者结果；输入 digest 保留 | PASS，独立字段未丢失；不覆盖任意共享键 reducer |
| NONE 路径 | 同一并行测试得到 draftVersion=1 和 feedback=NONE | PASS，仅合成响应，不证明真实模型会正确引用 |
| REWRITE | `rewriteRechecksNewDraftWithoutRerunningVisionOrEvidence`：新草稿被重新审查，Vision/Evidence 各调用一次 | PASS |
| SUPPLEMENT | `supplementRechecksDraftAgainstNewEvidenceWithoutRerunningVision`：证据与草稿到 v2，Critic 检查 v2，Vision 不重跑 | PASS，真实受控证据资格校验留在原领域服务 |
| 有界反馈 | `applicationFeedbackBudgetStopsRepeatedRewrite`：第二次反馈请求抛出 FEEDBACK_LIMIT，仅生成两版草稿 | PASS，限额是测试适配层策略，非框架内置医学规则 |
| 非法反馈 | `missingFeedbackCannotBeTreatedAsSuccessfulReview`：缺失反馈被明确拒绝，不能默认 NONE | PASS，非完整生产 JSON/quote 校验 |
| 节点增量 | `nodeStreamEmitsExplanationWhileCriticIsStillInFlight`：Critic 被屏障阻塞时已收到 Explanation NodeOutput，释放后才有 END | PASS，不是完成后重放或拆字伪 token |
| 并行节点观察 | `parallelLifecycleReportsEvidenceBeforeVisionCompletesButAfterStateIsNotTheResult`：Vision 未结束时收到 Evidence after；此时无 Explanation 和单独 Evidence NodeOutput | LIMITED，普通分支输出需汇合；after state 尚不含新结果 |
| 监听器守卫 | `lifecycleListenerExceptionDoesNotVetoExecution`：before 抛异常后 Explanation/Critic 仍执行并完成 | UNSUPPORTED，不能靠监听器执行安全拦截 |
| 角色失败 | `roleFailurePreventsExplanationAndCritique`：Evidence 抛 SOURCE_INVALIDATED 后不执行 Explanation/Critic | PASS，仅验证调度中断，不等同数据库回滚 |
| 取消与迟到 | `cancellingSubscriberStopsDownstreamButDoesNotStopProviderOrLateLifecycleCallbacks`：取消订阅后无草稿节点或草稿检查点；释放在途替身后仍有工作完成与 after 回调 | LIMITED，无持久取消或业务写 fencing 证明；必须做应用层守卫 |
| 跨 JVM 检查点 | `fourRoleCheckpointResumesInAnotherJvmWithoutRepeatingCompletedRoles`：汇合后、Explanation 前中断；序列化检查点，另一 JVM 仅执行 Explanation/Critic，保留 digest、Vision 和证据版本 | PASS，显式注册字段策略；仅受控中断，不是生产崩溃接管 |
| 递归上限 | `frameworkRecursionLimitCanCloseStreamWithoutSuccessfulEnd`：recursionLimit=1 的流结束，没有 END、反馈或 Critic 调用 | LIMITED，不能把 onComplete 当作业务成功 |

并行测试使用屏障与有界等待，不使用 sleep 猜测并发。每个测试使用独立固定大小并行线程池、有界队列和清理断言；恢复子进程有等待上限并在异常时强制回收。

## 源码与版本证据

检查的主来源是该版本 [Maven Central 源码包](https://repo.maven.apache.org/maven2/com/alibaba/cloud/ai/spring-ai-alibaba-graph-core/1.1.2.2/spring-ai-alibaba-graph-core-1.1.2.2-sources.jar)，不是最新版示例。包内源码根路径为 `com/alibaba/cloud/ai/graph/`。

| 制品 | SHA-256 |
| --- | --- |
| graph-core 1.1.2.2 binary JAR | `598D5AA825C88F156F47A1B760151F2C9EF5C7059BDFC7203FF95B4C173884AA` |
| graph-core 1.1.2.2 sources JAR | `7FAD01E85A2697C4590BD025DF1798C77A2DDA5BFCDD01551A99F92634B27E93` |

| 包内源码位置 | 核对内容 |
| --- | --- |
| `StateGraph.java`：362、382、392、441 | addEdge、列表分支/汇合及条件边 API |
| `CompiledGraph.java`：196–247、568 | 普通并行节点合成与 stream API |
| `internal/node/ParallelNode.java`：285–297、452、502 | 分支 before/after 使用分支快照；ALL_OF 汇合 |
| `OverAllState.java`：212–225；`GraphRunnerContext.java`：93–118 | 恢复通过 input 加载检查点，input 仅载入注册策略的键 |
| `serializer/check_point/CheckPointSerializer.java`：35–52 | 检查点序列化/反序列化 |
| `utils/LifeListenerUtil.java`：71–84；`GraphRunnerContext.java`：316–326 | 监听器异常被捕获；不能 veto |
| `executor/NodeExecutor.java`：121–130、202–207 | 执行动作后从 future 取得结果，再构建输出与继续执行 |
| `executor/MainGraphExecutor.java`：57–60 | 达到递归上限进入 handleCompletion，不代表 END 或业务成功 |

可用 `javap` 核对实际 binary 的 StateGraph / CompiledGraph / CompileConfig / RunnableConfig 签名；本轮同时检查了签名与源码包，未升级依赖。

## 测试结果与复现

使用指定 JDK 21，在独立工作树执行：

```text
mvn -o -B -Dtest=RealtimeGraphSpikeTest,CoordinationPocTest test
```

最终运行于 2026-11-11 17:34:51 +08:00 完成，BUILD SUCCESS：新增专项 12 项、既有 CoordinationPocTest 4 项，共 16 项通过，0 failures、0 errors、0 skipped。总构建时间 19.995 秒；专项用例总耗时 1.250 秒，既有 PoC 0.498 秒。计数来自本次 Surefire XML，每个用例名称保存在 [results.json](realtime-graph-spike-20261111/results.json)。该命令会编译项目，但只执行指定类；不代表全量后端通过。

本地原始报告：`target/surefire-reports/TEST-com.csust.eyediagnosis.poc.realtime.RealtimeGraphSpikeTest.xml`、`target/surefire-reports/TEST-com.csust.eyediagnosis.poc.CoordinationPocTest.xml`。CI 现有 backend-unit 的 `mvn -B test` 会按测试命名发现该专项；本轮没有提交或触发 hosted CI。

开发中保留了具有实际失败断言的验证过程：顺序拓扑无法通过并行屏障；无反馈边时 REWRITE 没有生成 v2；仅依赖框架 recursionLimit 不能给出业务预算错误；默认 NONE 会接受缺失反馈。修复夹具后这些测试通过。

恢复实验还发现实质性缺陷：默认空 key strategy 时，序列化检查点中有结果，跨 JVM 恢复的节点却读不到 evidenceVersion。显式注册状态字段后恢复通过。该测试以后移除字段策略即会重新失败，不能用旧的常量状态恢复 PoC 替代这一验证。

## 剩余项、下一卡与回滚

决策记录见 [ADR](../architecture/multi-agent-adr.md)。继续 TASK-03，在现有 Coordinator 上建设稳定 run 与持久领域事件；框架生命周期回调只能作观察来源，业务事件须在有效领域提交后公开。M2 再验证 Graph 与原执行器的等价性和恢复事务。

本轮 NOT_RUN：Studio / DeepResearch 集成、模型真实 token 流、真实提供方与引用质量、真实反馈样本、MySQL 迁移/事务/租约接管、取消与终态提交竞态、SSE/权限投影/重放、React/浏览器、正常图像/OOD、医生复核与发布、性能/成本、全量后端和 hosted CI。工作树迁移冲突仍未修复，生产开关未启用。

本次仅有测试与文档。回滚为撤下该专项和说明；无业务数据或 schema 变更，无活动正式 Graph run。不得以本报告将 Graph 开关打开，或把受控模型替身结果表述为自治质量、临床或生产验收。

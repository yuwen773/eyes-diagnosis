# TASK-03：现有 Coordinator 的持久事件与 SSE 验收

2026-11-11。结论：**TASK-03 的后端工程专项 PASS；M0 整体仍 PARTIAL，M1 的真实提供方与生产放行证据仍 PARTIAL。** 本报告不代表 Graph 迁移、临床、正式 React 工作台或生产验收。

分支 `codex/realtime-coordinator-events`；独立工作树 `realtime-coordinator-events`；基线 `6572743169027bb1e7c27d7d969a26ed89d99cd1`。变更尚未提交、暂存、推送或部署，因此验收对象是基线加本卡文件内容，不能仅用 HEAD 代表。代码/契约/CI 文件的 SHA-256、Surefire XML 标识和逐用例结果见 [results.json](realtime-coordinator-events-20261111/results.json)。

输入是实施计划 v1.1 的 TASK-03 及已完成 TASK-01 的限制：Graph 生命周期监听器不能作守卫，取消订阅不能保证提供方停止。没有搬入 SPIKE 的未提交测试，没有复制原工作区的 OOD、V15 或其他已有改动。

## 已交付

- 稳定 runId 与 taskId、threadId、owner、推理摘要、固定 Coordinator/workflow 绑定；相同请求幂等、冲突与可信后台受理。
- Coordinator 真正的节点开始、验证后完成、证据冻结、草稿版本、定向交接、真实 Critic 反馈和终态事实；状态与事件同事务提交。
- DTO v1、患者状态投影、管理员/获分配医生的元数据投影；原始模型正文、prompt、上下文、影像地址、隐藏推理均不进入本卡 API。
- 一致性快照、水位 H、授权主体/投影绑定的 AES-GCM 不透明游标、断线重放、合法过滤跳号、400/403/409/410 分类。
- 持久取消意图、幂等确认、排队/在途/最终 Critic 边界与迟到写拒绝；SSE 关闭不取消任务。
- 每批及每次发送前复查当前 SessionRepository 和数据库授权；有限连接、缓冲、心跳、超时与慢消费者关闭。
- Java 线追加 V18；新增专用 MySQL CI job、显式 opt-in 和零跳过/丢用例门禁；同步迁移头/API 索引文档。

冻结协议与默认值见 [collaboration-runs.md](../collaboration-runs.md)。新增功能默认关闭，需要明确开启和持久游标密钥；没有启用 Graph，也没有修改医生批准、来源复验或患者保存许可。

## 本次验证

使用指定 Corretto JDK 21、离线 Maven、隔离 MySQL，外部模型为确定性结构化响应。测试使用真实 Coordinator、真实数据库事务与事件查询；HTTP 项使用本地真实 Tomcat/Java HTTP Client 和内存 Spring Session，**未使用真实 Redis session、真实模型提供方或浏览器**。

```text
mvn -o -B -Dtest=CollaborationRunTest,PatientDraftTest,CoordinationPocTest test
```

最终运行完成于 **2026-11-11 18:10:48 +08:00**，总构建耗时 **37.512s**：

| 套件 | tests | failures | errors | skipped |
| --- | ---: | ---: | ---: | ---: |
| CollaborationRunTest（含 REWRITE / SUPPLEMENT 参数用例） | 22 | 0 | 0 | 0 |
| 原 PatientDraftTest | 41 | 0 | 0 | 0 |
| 原 CoordinationPocTest | 4 | 0 | 0 | 0 |
| 合计 | **67** | **0** | **0** | **0** |

原始本地结果为 `target/surefire-reports/TEST-*.xml` 与 `target/task03-tests.log`，后续运行可能覆盖。仓库 JSON 保留本次计数、XML 哈希、文件哈希及每个用例名，不保存日志中的凭据或患者材料。

| 验收能力 | 实际证据 | 结果与边界 |
| --- | --- | --- |
| 正常与患者隐私 | `normalCoordinatorPersistsOrderedFactsAndKeepsPatientDraftPrivate` | 真四角色 Coordinator；患者无草稿、标签、对象位置或医生交接事件；SUCCEEDED 仍为 PENDING |
| 增量而非事后拼接 | `eventsAreIncrementalWhileVisionIsStillInFlightAndSnapshotHasExactBoundary` | Vision 阻塞期间可读 Evidence 完成，快照角色状态/水位一致 |
| 真实 HTTP 增量与断线 | `liveHttpSseReplaysRealEventsAndRejectsFaultsBeforeOpeningTheStream` | Tomcat 发出真实 id/event/data；第二个运行在 Vision 返回前经 HTTP 收到 Evidence 完成；关闭 body 后任务仍成功 |
| 幂等与重放 | `replayAndDuplicateCreationNeverRepeatTheCoordinator` | 重复创建/读事件/游标续读不增加模型调用；成功后取消返回 ALREADY_TERMINAL |
| 跨进程持久性 | `separateJvmReplaysTheSameCommittedFactsAndOpaqueCursorWithoutExecuting` | 另一 JVM 解密相同游标，重放完整同值 DTO，模型入口若被调用即失败；不等同执行器续跑 |
| 回滚 | `rolledBackDomainStateNeverPublishesAnEvent` | 回滚同时撤销状态、水位与事件；无领域事务的事件写入被拒绝 |
| 医学受限与故障分类 | `restrictedAndUnreadyInputsDoNotStartAgents`、`providerFailuresAreClassifiedSeparatelyFromRestrictedModelOutput` | 未就绪、已有受限、拒识输入不启动角色；401/429/503/非法 JSON 分类保留，均无伪成功 |
| 真反馈 | `feedbackFactsComeFromActualCriticRouting(REWRITE/SUPPLEMENT)` | 真实角色路由产生反馈和后续版本/调用；这是确定性模型夹具，不是模型反馈质量证据 |
| 在途取消与迟到输出 | `cancellationWinsAgainstUncooperativeInFlightProvidersAndRepeatedCancellationIsIdempotent` | 忽略中断的两个提供方替身返回后无新增事件/草稿；重复取消不增加事实 |
| 排队、最终结果、终态竞态 | `cancellationBeforeDispatchAndRecoveryOfCommittedCancelIntentNeverCallProviders`、`cancellingAtFinalCriticBoundaryCannotCommitReviewReady` | 排队取消无角色执行；恢复已提交取消意图；最终 Critic 取消不提交复核。终态先提交路径另由重放用例验证 |
| 快照并发 | `concurrentSnapshotWaitsForCancellationStateAndItsEventWatermarkTogether` | 人为阻塞取消事务提交，快照等待后同时见 CANCELLED、STOPPED 角色及准确 +2 水位 |
| 跨账号/权限 | `crossAccountAndUnassignedDoctorCannotReadSubscribeOrCancelAndMissingRunsMatch` | 查询、订阅、取消独立拒绝；未分配医生无细节；不存在与无权一致 |
| 游标 | `opaqueCursorsRejectTamperingCrossSubjectConflictsExpiryAndChangedProjection` | 格式/完整性、跨主体、双游标冲突、7 天失效、投影变化和未来水位被拒绝 |
| 活动授权撤回 | `activeSubscriptionStopsOnSessionRevocationAndDisconnectDoesNotCancelRun`、`assignedDoctorLosesExistingSubscriptionWhenGrantIsWithdrawn` | 会话身份变化或数据库医生授权删除，停止后续发送；提供方任务与订阅解耦 |
| 慢消费者与限额 | `slowSubscriberHasFiniteBufferAndCanReplayEveryDurableFactAfterClosure`、`subscriptionLimitAndShutdownReleaseSlotsWithoutCancellingTheRun` | 可阻塞 sink 的真实持久轮询，超 64 帧关闭且全部事实可重放；订阅槽位回收。不代表真实网络慢读负载性能 |
| 绑定/并发 | `idempotencyConflictsAndConcurrentAdmissionsCannotCreateDuplicateRuns`、`changedInferenceBindingIsRejectedBeforeAnyModelCall` | 并发同键只创建一次；输入变化与其他键冲突；排队期间推理变化不启动新角色 |

附加检查：

- Python 门禁测试 **34/34 PASS**；包含新专项漏报、跳过和删用例负例。
- `check_surefire_skips.py ... collaboration` 与 `... issue19` PASS。
- steering docs、设计文档、概率刻度、`git diff --check` 均 PASS。
- 未设置数据库变量时，专项显式报告 **22 tests / 22 skipped**；这是 opt-in 发现检查，单列且不计入 67 项验收。
- 比对原工作区开工前 SHA-256 清单：**34 个文件内容全部未变**；原工作区暂存区未动。

## 验证中发现并修复

1. MySQL 驱动的 `queryForList` 可把 DATETIME 返回为 LocalDateTime。事件读取改用 ResultSet.getTimestamp，避免直接强转造成重放失败。
2. 并发创建时，默认 REPEATABLE_READ 的早期授权查询会建立旧快照；即使后来等到用户锁，也可能读不到另一请求提交的幂等行。受理先锁用户，应用事务改为 READ_COMMITTED，幂等键使用当前锁定读取。
3. 通用 Jackson mapper 的时间格式可能变成数字。DTO 明确 ISO 字符串；跨 JVM 比较解析后的完整 Event DTO，避免 LongNode/IntNode 的内存类型差异伪报失败。保留了完整事件比较，没有删字段。
4. BeforeAll 的环境 assumption 会把整个类显示为 0 tests，绕过用例发现。环境跳过移到 BeforeEach，使 22 个用例在通用 job 中逐项显式跳过，专项 job 中必须全部运行。
5. 订阅关闭清除队列并 purge 已取消写任务；连接启动/立即关闭竞态会撤销后来注册的轮询，防止残留定时任务。

## 尚未放行

| 项目 | 状态 / 原因 |
| --- | --- |
| hosted CI、MySQL 8 的新 CI job | NOT_RUN；仅新增定义，未提交/推送或触发远端执行 |
| 全量后端 | NOT_RUN；这里只运行三套明确列出的测试 |
| 全部 Flyway 升级历史/空库用户引导 | NOT_RUN；V18 DDL 已用于专项隔离库；Java/master 的 V15–17 分歧、原工作区未跟踪 V15 均未解决，不声称生产迁移通过 |
| 真实 Redis session 撤回 | NOT_RUN；本次用真实 SessionRepository 边界和内存实现；生产实现仍需联验 |
| 真实模型引用、REWRITE/SUPPLEMENT 质量及正常医学输入 | NOT_RUN；本卡仅使用合成输入和模型响应，不将此前提供方/OOD 证据重新记为本轮通过；早期验证仍需 TASK-06 补齐 |
| Graph 等价性、租约接管、fencing 和已完成节点续跑 | NOT_RUN，属于 TASK-02；现有执行器崩溃仍按原 deadline 收敛为 FAILED，不冒充已支持节点恢复 |
| React/浏览器、医生发布/患者保存、真实模型 E2E | NOT_RUN，继续 TASK-04/05/06/07 |
| 延迟 SLO、真实网络慢读、容量/成本/生产回滚 | NOT_RUN；64 帧、8/2 连接、250ms 轮询、15s 心跳、180s 连接、7 天游标均为已记录的开发默认值，尚非生产放行参数 |

当前可把冻结协议交给 TASK-02 和 TASK-04；不以本报告启用正式 Graph 或宣称整个 M1/实时产品完成。生产前还须按既定专项解决实际迁移历史与缺失的真实验收证据。

回滚遵循协议文档：先停止新受理、排空/持久取消活动 run，再关闭新功能；保留 V18 表与事实用于审计，不删除历史。旧聊天、医学门禁和现有医生批准/保存接口维持原边界。

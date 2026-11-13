# 实时多 Agent v1.1：实施准备与开工清单

采集时间：2026-11-11 17:14 +08:00。状态：实施准备已完成，可开始 TASK-01；M0 尚未整体验收。

基线：[实施计划 v1.1](EyesDiagnosis_RealTime_MultiAgent_Implementation_Plan_v1.1.md)。本轮范围是阅读、源码核对、分支审计和既有 PoC 验证；未实现新业务功能、未启动真实模型调用、未提交或发布。

## 1. 当前基线

| 项目 | 本轮核对结果 |
| --- | --- |
| 工作树 | `D:/Work/code/eye-diagnosis/.claude/worktrees/java-multi-agent-arch` |
| Java 分支 / HEAD | `worktree-java-multi-agent-arch` / `6572743169027bb1e7c27d7d969a26ed89d99cd1` |
| React 对照分支 / HEAD | `master` / `a0efaf46d6f8b53bea4a35d613fc806e2f6e9d47` |
| 远端 | GitHub 连接器实时读取同名分支提交，两者均与上述本地 SHA 一致；未执行 fetch 或改动引用 |
| 共同祖先 | `f11a677de8755638c3852e22e961a43ef01a2804` |
| 分叉规模 | `git rev-list --left-right --count HEAD...master` 为 `40 / 94`，不具备直接快进条件 |
| 正式前端 | 当前树没有 `web/`；`master:web/` 有 React 19、TypeScript、Vite、Tailwind v4、Vitest 和 Playwright |
| 设计来源 | 已读取 `master:web/DESIGN.md`；其完整设计系统引用 `master:DESIGN.md`，色值以 `web/src/styles/tokens.css` 为准 |
| Java / 构建工具 | 指定 Corretto JDK 21.0.7、Maven 3.9.9；PowerShell 7.6.9 |
| 依赖 | POM 锁定 Spring AI `1.1.2`、Alibaba `1.1.2.2`；本次测试 classpath 确认 model、agent-framework、graph-core 使用对应版本 |
| 工作区 | 开始时 `git status --short` 有 25 条记录，其中目录被折叠；展开为 33 个已有变更/未跟踪文件，暂存区为空 |
| 计划内容标识 | SHA-256：`CD3B1BCD51FED7EFB6479DBF6AB38B04584A7AC194C06DFC9392676CBE8990BB`；计划尚未跟踪，不能只用 HEAD 表示其内容 |

远端证据：[Java 提交](https://github.com/yuwen773/eyes-diagnosis/commit/6572743169027bb1e7c27d7d969a26ed89d99cd1)、[master 提交](https://github.com/yuwen773/eyes-diagnosis/commit/a0efaf46d6f8b53bea4a35d613fc806e2f6e9d47)。这些值是本次采集快照，后续开工重新记录。

## 2. 已确认的差距与阻塞

### 2.1 数据库历史冲突：阻止整分支直接合并

| 版本 | 原 Java 线 | master | 2026-11-13 处理 |
| --- | --- | --- | --- |
| V10–V14 | 诊断任务、受控引用、草稿、医生复核、患者授权 | 对照树未包含这些迁移 | 单调重排为 V18–V22 |
| V15 | 工作区未跟踪的 `V15__bootstrap_user_table.sql` | `V15__baseline_legacy_tables.sql` | 删除重复 bootstrap，采用 master V15 |
| V16 | `V16__patient_draft_message_timing.sql` | `V16__diagnosis_evidence_and_audit.sql` | Java 线重排为 V23，采用 master V16 |
| V17 | `V17__autonomous_draft_workflow.sql` | `V17__news_business_model.sql` | Java 线重排为 V24，采用 master V17 |
| V18–V20 | 协作事件、图执行、agent 历史 bootstrap | — | 重排为 V25–V27 |

直接合并会留下同版本不同迁移；主干数据库也可能已经越过 Java 线新增的低版本迁移。不能通过修改已应用脚本、删除 Flyway 历史或盲开 out-of-order 解决。本轮采用的整合方式：以 master 的 V1–V9 + V15–V17 为已部署基线，保留其脚本原样；Java 线自己的 V10–V20 整体单调重排到 V18–V27（内容不变），并删除与 master V15 重复的 `t_user` bootstrap。这样任一已部署库的版本链都是单一、递增的。

Java 线旧开发库（已应用 V10–V20）不在生产序列中，按迁移矩阵直接重建；master 生产库从 V17 顺序追加 V18–V27。迁移矩阵、校验步骤与演练脚本见 [Flyway 迁移矩阵](../architecture/migration-matrix.md)。后续新迁移必须大于 V27，不得再重排或复用已发布版本号。

### 2.2 正式前端未在当前树

`master:web/src/pages/AgentPage.tsx` 已有上传、会话、历史和发送；当前上传后仍调用普通聊天 `send(...)`。现有 `web/src/lib/agentStream.ts` 维护聊天消息、reasoning 和工具事件，没有协作运行协议。

前端整合应保留这些能力，单独增加协作 reducer/hook。旧聊天 reasoning 路径不能直接作为新协作轨迹出口。当前 Vue 管理员页面及历史轨迹不构成本计划的 React 实时交付。

### 2.3 执行器恢复与事件并非现成功能

核对入口：`patientdraft/PatientDraftCoordinator.java`、`DraftAgents.java`、`DraftMailbox.java`、`PatientDraftRunner.java`、`diagnosistask/DiagnosisTaskRunner.java`、`controller/AgentController.java`。

- Coordinator 已有事务领取、推理绑定、并行 Vision/Evidence、定向信封、版本、预算、证据冻结及最终复验，应继续复用。
- `start()` / `recordResult()` / `freeze()` / `saveDraft()` / `restrict()` 与完成门禁是 M1 候选事实事件提交点；现有 `Message.sequence` 是角色调用登记顺序，不能直接当作协作事实事件完成顺序。
- 草稿 worker 默认关闭、轮询默认 5000 ms；仅靠轮询不能保证计划中的快速受理目标，M1 需明确可信触发及后台执行边界。
- 当前草稿运行按 taskId 绑定，缺少计划要求的稳定 runId、threadId 关系、runtimeKind、持久取消意图和草稿执行租约接管。
- 推理任务已有 `leaseOwner / leaseToken / leaseUntil / version` 条件写入；不能据此宣称草稿执行器已经具有同等 fencing 与恢复能力。
- 草稿崩溃后目前到期进入 `INTERRUPTED_OR_TIMEOUT`，不会续跑已提交节点。v1.1 的节点复用、预算内重试和新 token 接管属于新增可靠性工作。
- `/agent/chat/stream` 是普通聊天 SSE；四角色尚无持久事件、授权投影、游标重放和取消接口。

### 2.4 正常医学输入和真实反馈仍需独立证据

当前 Coordinator 仍要求可信快照、合法标签、未拒识且 OOD 为 `IN_DISTRIBUTION`。无效输入在模型调用前受限，不能为展示而放宽。

已有本地报告记录真实提供方引用失败及 REWRITE/SUPPLEMENT 样本不足；本轮没有重跑提供方、检查新增 OOD artifact 或正常图像链路。参考 [协作交付报告](../testing/2026-11-11-multi-agent-collaboration-report.md)、[OOD 缺失项](2026-11-10-ood-missing-input-checklist.md)。这些是历史/资料证据，不能转记为本轮通过。

## 3. 变更隔离与分支整合策略

1. TASK-01 从上述 Java SHA 建立独立、干净的实施工作树；只增加隔离测试和必要说明，不复制当前脏工作区。
2. 保留现有 `AGENTS.md`、`CLAUDE.md`、算法 OOD、`DiagnosisTaskApiTest`、`check_issue17_reports.py`、Vue 侧栏、V15 及证据文件。原计划本身也未提交，需要随相应文档交付单独纳入范围。
3. React 阶段在专用整合分支按完整 SHA 引入 `master:web/` 及经审核的设计/构建必需文件。逐项核对 API 兼容，不整分支盲合，不覆盖 Java 领域服务；实施时重新读取该分支的约束。
4. 数据库历史专项已于 2026-11-13 按 §2.1 处理：master V15–V17 原样保留，Java 线迁移单调重排为 V18–V27。后端卡片以合并后的链为基线；新迁移编号必须大于 V27，不得再预占或重排既有版本。
5. 每卡只暂存自身文件，记录目标 SHA 和测试环境。Graph 开关保持默认关闭；M0 不改正式 Coordinator 或用户入口。

以上是后续执行策略，本轮未创建工作树、搬运前端或实施迁移修复。

## 4. 首张任务卡：TASK-01

目标：锁定 `1.1.2.2`，用真实框架和确定性角色替身建立四角色 Graph 能力矩阵。替身只替代模型响应；不能替代 Graph 调度器。

建议新增范围：`src/test/java/com/csust/eyediagnosis/poc/realtime/` 下的隔离 Graph 与测试，以及 Graph 能力报告。既有 `poc/CoordinationPoc*` 用作参考和回归，不删除有价值断言。POM、业务表和正式运行开关保持原值。

| 能力 | 需要验证的可观察行为 | 本轮状态 |
| --- | --- | --- |
| 基础 Graph 与 checkpoint | 已有固定转移、序列化后恢复、同一次中断的状态/检查点绑定 | PASS，既有 4 测试 |
| 四角色并行汇合 | 屏障证明 Vision/Evidence 重叠，Explanation 等两者完成且不丢并行状态 | NOT_RUN |
| 真实节点增量 | 阻塞后续角色时，已发生的节点事件可被消费；不是终态轨迹拆分 | NOT_RUN |
| 条件反馈 | NONE / REWRITE / SUPPLEMENT 的合法路由、版本与有界终止 | NOT_RUN |
| 停止与迟到结果 | 可停止后续派发；忽略中断的替身返回也不能写入已终止运行 | NOT_RUN |
| 四角色恢复 | 中断、重建图、恢复时已提交节点不重复；不能只证明同 JVM 内存状态存在 | NOT_RUN |
| 框架与领域边界 | 标出哪些依赖框架，哪些必须由事务、预算、租约和 fencing 补齐 | 待报告 |

完成门槛：每格附测试名、命令、实际计数及 API 来源；记录该版本源码/源码包标识，不直接以最新版官方示例推定兼容。Studio 启动兼容和真实 token 流另外列项，未验证即 NOT_RUN。SPIKE 通过不等于 M2 等价性通过。

## 5. 后续卡片入口与契约冻结项

执行依赖：TASK-01 → TASK-03 → TASK-02 / TASK-04 → TASK-05。TASK-06 的小样本验证从 M0/M1 开始，TASK-07 的权限约束贯穿各卡。

| 阶段 | 本阶段交付 | 必须保留的验收边界 |
| --- | --- | --- |
| M0 / TASK-01 | 四角色 SPIKE、能力矩阵、ADR、协议草案、分支整合策略、早期提供方记录 | 本轮只完成其中基线审计及既有 PoC 重跑 |
| M1 / TASK-03 | 现有 Coordinator 的 run 绑定、事务事件、授权快照、SSE、取消 | 不以 Graph 重写替代现有执行器事件基线 |
| M2 / TASK-02 | Graph 角色适配与确定性等价性、故障恢复 | 运行归属固定；NONE/反馈/负例/取消/恢复逐项对照 |
| M3–M4 / TASK-04–05 | React reducer/hook、原 /agent 工作台升级 | React 正式入口、旧聊天回归、主题/移动/a11y/Playwright |
| M5 / TASK-06 | 真实引用与反馈样本、预注册对照 | 夹具、真实提供方、真实医学输入分别计数 |
| M6–M7 / TASK-07 及总验收 | 医生权限、发布、恢复、性能和回滚 | 正常/受限/故障/取消分项记录，全部门禁通过才整体放行 |

M1 编码前需冻结以下技术契约，不能把计划示例当作已有接口：

- taskId / runId / threadId / owner / inferenceDigest 的唯一关系、幂等冲突；明确推理尚未就绪、受限输入如何受理和展示，角色启动仍遵守安全门禁。
- schema v1、字段白名单、actor/type 枚举、错误映射、载荷上限、兼容规则，以及执行状态与审核状态的独立迁移表。
- 以计划 §5.6 为准：SSE `id` 是绑定主体和投影版本的不透明游标；DTO `eventId/sequence` 仅用于事实标识/幂等。合法过滤跳号不触发重跑。
- 同一读取边界的快照水位 H；从 H 后重放；通知只唤醒，事件仓库负责追赶；410/400/409 均在开启 SSE 前确定。
- 取消与结果/终态提交的事务顺序、ALREADY_TERMINAL、迟到输出拒绝、租约与 fencing；不能把关闭连接视为取消任务。
- 已建立订阅的权限撤回、有限缓冲、心跳、保留窗口、并发限额及超时默认值。性能值先测量，再记录冻结依据。
- `review_ready` 后 `completed` 的提交顺序与原子性；患者只见待复核，批准后仍复用来源复验及保存授权门禁。

## 6. 本轮验证与未验证项

在指定 JDK 21 下执行：

```text
mvn -o -B -Dtest=CoordinationPocTest test
```

结果：BUILD SUCCESS；4 tests，0 failures，0 errors，0 skipped；总构建时间 19.226 秒。读取 Surefire XML 确认计数与实际依赖 classpath。编译过程包含主源码与测试源码，但只运行上述测试类。

证据位置：`target/surefire-reports/TEST-com.csust.eyediagnosis.poc.CoordinationPocTest.xml`（本地生成文件，后续运行可能覆盖）。该结果适用于当前 HEAD 加已有工作区改动，不代表仅该提交的干净检出验收。

未运行：四角色新 SPIKE、MySQL 专项/迁移历史查询、全量后端、React 构建与浏览器、Studio、真实提供方 smoke、正常图像/OOD 链路及 E2E-01–20。未测试的能力均不放行。

当前结论：可以开始无数据库的 TASK-01；整分支合并受迁移历史冲突阻塞。实时工作台、Graph 迁移、真实模型反馈质量、医生复核及正常医学输入链路仍分别待验收。

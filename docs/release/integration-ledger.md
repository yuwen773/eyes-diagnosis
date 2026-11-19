# Iris 发版集成台账（Integration Ledger）

> 本轮集成的唯一记录处。每完成一批就更新，不依赖对话记忆。
> 起始时间：2026-11-18 晚；最后更新：2026-11-19 12:45（+08:00，NO_GO 定向整改轮）。

## 0. 基线与工作树

| 项 | 值 |
|---|---|
| 集成分支 | `integration/iris-release-candidate` |
| 集成工作树 | `.worktrees/integration-rc` |
| 起点 | `origin/ui@1ff9c71c`（PR #118 合并后的 ui tip） |
| UI 冻结 tag | `iris-ui-v2.1-freeze-20261115` → `80f53f7f`（**未移动**，本轮不碰） |
| `origin/master` | `a0efaf46`（与 `ui` 不同线，本轮不改） |
| 旧 release 分支 | `release/v1.0.0@5ac742f0`（不复用、不重写） |

## 1. 契约裁定（本轮最重要的一条）

`ui` 与 #111 各带一套工具事件状态机，不能并存。裁定如下：

| 维度 | 唯一口径 | 来源 | 被否决的一侧 |
|---|---|---|---|
| 状态字段 | `toolStatus` | ui（#117 已合入） | #111 的 `status` |
| 状态词表 | running / succeeded / failed / cancelled / awaiting-confirm | `ToolStepContract` (ui) | #111 的 success / error / timeout / completed / unknown |
| 旁路观察 | `ToolExecutionInterceptor` + `ToolStepSink` | ui | #111 的 `ToolExecutionObserver`（已删除） |
| 工具正文 | 终态帧 `content`（脱敏 + 32k 截断） | 合并新增 | #111 独立的 tool-response 通道 |
| 结构化来源 | 终态帧 `resources`，仅成功调用携带 | #111 的 `ToolResourceContext` 并入 ui 拦截器 | — |
| 时间 | `timestamp` 带偏移 ISO-8601 | #111 的 `TimeFormats` | — |
| 落库 | 终态帧 → `{toolCallId,name,status,output,resources}` | 合并新增 | — |

**判据**：一套状态机、一个观察点、一条 SSE 通道；任何一侧的既有能力不得因合流丢失。

## 2. 批次进度

| 批次 | 内容 | 状态 | 证据 SHA |
|---|---|---|---|
| B1 | #112 Agent 运行时护栏（预算 + 递归上限 + 异常处理器） | ✅ 已合入 | `eaa8f409` |
| B1 | #111 R3 Agent（时间契约、资源闭环、P0/P1） | ✅ 已合入 | `995097fc` + `1d69698c` |
| B1 | P0 方法工具异常误判 | ✅ 已修（真实路径） | 见 `conflict-resolution.md` §3 |
| B1 | P1 旧回合步骤被 streaming 叫醒 | ✅ 已修 + 3 项回归 | `1d69698c` |
| B2 | #101 System States R2 | ✅ 已合入 | `8ad5d38c` |
| B3 | 工程清理 #106–#110、#113–#116 | ✅ 已合入（12 个 merge） | `25f679dd`…`b433b931` |
| B4 | 跨功能回归 + 独立四路 Review | ⏳ 进行中 | 见 §6 |

## 3. 已关闭的阻断

### P0 · Spring AI Alibaba 1.1.2.2 把方法工具异常记为成功

- **根因（字节码复核）**：`AgentToolNode#executeSyncTool` 的两条 catch 不对称：
  `catch (ToolExecutionException)` → `processor.process()`（默认 `alwaysThrow=false`，返回字符串）
  → `ToolCallResponse.of(...)`，`status == null` ⇒ `isError() == false`；
  `catch (Exception)` → `ToolCallResponse.error(...)`。
  框架自带的 `ToolErrorInterceptor` 同样用 `of(...)`，不构成修复。
- **修法**：`toolExecutionExceptionProcessor(alwaysThrow=true)` + 最外层
  `ToolFailureBoundaryInterceptor` 把逃逸异常转成 `ToolCallResponse.error(...)`。
- **效果**：失败不再被记成 success；会话不中断（模型收到真正的工具错误后继续收尾）。
- **验收**：`DiagnosisAgentToolEventTest`（11 项）+ `AgentGuardrailWiringTest`（4 项）。

### P1 · 旧回合工具步骤重新变成「执行中」

- **根因**：`buildThread(messages, streaming)` 的 `streaming` 是页面级状态。
- **修法**：只有「排在最后且后面再没有消息」的过程块才可能保留 running。
- **验收**：`agentSteps.test.ts` 跨回合 3 项回归。

### P1 · 影像分析失败被包装成「成功」（Reviewer C）

- **现象**：`EyeImageAnalyzerTool#analyzeOwnedImage` 把视觉模型不可用写成
  `EyeAnalysisResult("图像分析失败")`，框架看到的是正常返回 → 步骤状态 `succeeded` → 界面显示「完成」。
- **修法**：异常向上抛（`BusinessException(SYSTEM_ERROR)`），由 `ToolFailureBoundaryInterceptor`
  转成真正的工具错误；模型空返回也按失败处理；不再把模型原文写进日志。
- **验收**：`UserBoundEyeImageAnalyzerToolTest`（断言抛 50000 且 COS 已读）。

### P1 · 图片附件先落库后校验（Reviewer C）

- **风险**：`imageUrls` 先写进 `t_agent_message`，才在 `DiagnosisAgent` 里做归属校验；
  被拒绝的请求仍会在历史里留下外部图片地址，下次回放自动加载，
  绕过「不加载远程图片」的策略。
- **修法**：`AgentController` 在 `saveUserMessage` 之前逐条调
  `AgentImageUploadService#resolveOwnedImageId`，与 `DiagnosisAgent` 同一份口径。

### P2 · 历史回放的「幽灵步骤」（Reviewer A）

- **现象**：请求行只存模糊标签、不带 `toolCallId`，终态行带 id，回放时配不上，
  一次调用被拆成「未确认 + 完成」两步。
- **修法**：请求行改存 `{toolCallId,name,stepLabel}`（单次为对象、多次为数组）；
  参数仍不入库；前端 `parsePersistedToolCall` 同时认对象与数组。
- **验收**：`agentSteps.test.ts`（单次配对、多工具各自成步）、`agentStream.test.ts`（数组解析）、
  `DiagnosisAgentRedactionTest`（请求行含 id 但不含参数）。

### P2 · 工具正在跑却显示「返回了空结果」（Reviewer B）

- **现象**：`ToolStepSink` 的 RUNNING 帧也用 `tool-result` 发（content 恒空），
  前端 `tool-response` 分支无差别地标 `received=true`；慢工具与被「停止」的回合都会在「执行中」旁边
  写「工具返回了空结果」。
- **修法**：`agentSteps` 对 `running` 状态帧只更新状态，不标已返回、不写输出。
- **验收**：`agentSteps.test.ts`（running 帧不冒充结果）。

### P2 · 老库上超长工具结果静默丢行（Reviewer A）

- **风险**：32,000 字符上限不等于字节上限；V27 之前建库的 `content` 列仍是
  `TEXT`（65,535 字节），32k 中文约 96 KB，写入 1406 失败发生在异步队列里，
  用户只看到「刷新后这一步变成未确认」。
- **修法**：对外发正文再按 UTF-8 **字节**收敛到 48,000，只在码点边界断开。

### P2 · P0 缺端到端证据（Reviewer A）

- **风险**：原有用例覆盖的是拦截器本身，不是「框架真会把异常交给拦截链」；
  若 `alwaysThrow` 或 boundary 顺序被改，单测仍然全绿。
- **修法**：新增 `AgentToolFailureEndToEndTest`：真 `@Tool` 抛异常 + 真 `ReactAgent`，
  断言终态为 `failed`、成功数为 0、模型在异常后仍被调用收尾；
  另加一条对照组（工具正常返回必须记成功），防止边界被写成「一律失败」。

## 4. 阻断进度

| 编号 | 项 | 级别 | 状态 |
|---|---|---|---|
| O-1 | #101 与清理类 PR 合入 | 批次 | ✅ 已关闭（12 个 merge） |
| O-2 | 完整后端全量验证（`scripts/verify.sh`） | 门禁 | ✅ 在最终代码 SHA 上重跑，结果见 `verification-matrix.md` |
| O-3 | 真实后端链路（SSE / 工具失败 / 权限隔离） | 门禁 | ❌ 未执行（需 DashScope 凭据） |
| O-4 | 四路独立 Review（A/B/C/D） | 门禁 | ✅ 已完成，结论与整改见 §6 |
| O-5 | 发布说明、升级/回滚手册 | 交付物 | ✅ 已入库 |
| O-6 | GitHub Actions（候选 SHA 对应的全部 job） | 门禁 | ✅ PR #119 head `6ff5a889` **21/21 成功**（run 44442060009） |
| O-7 | Playwright `web-e2e-system-states`（R2 14 条） | 门禁 | ✅ 由 CI job 跑过（本机缺 chromium） |
| O-8 | 双主题 / 响应式回归截图 | 门禁 | ❌ 未执行（需浏览器截图证据） |

## 5. 边界

- 不合并到 `ui` / `master`，不打 tag，不部署 —— 需 owner 批准。
- 不修改冻结 tag，不删除历史证据脚本。
- 冻结范围内（首页/品牌层、管理端、知识库、新闻工作台）不做视觉迭代；
  #102 因此推迟。

## 6. 四路独立 Review（2026-11-19）

四个独立 agent 各自读实现与测试，不看实施方摘要。结论与处置：

| Reviewer | 视角 | 结论 | 关键发现 | 处置 |
|---|---|---|---|---|
| A | Agent / Java | PASS_WITH_P2 | P0 修复三层独立核实成立（拦截链顺序、`alwaysThrow` 真抛、逃逸后会话继续）；无第二套状态机；预算 per-run | P2-1 幽灵步骤、P2-3 老库 TEXT 字节上限、P2-4 P0 缺端到端证据 → 均已修；P2-2/P2-5 登记为债务 |
| B | React / UI | PASS_WITH_P2 | 无 P0/P1；P1 修复的四个边界（停止 / 断流 / 刷新 / 乱序）成立 | P2：`running` 帧走 `tool-result` 通道被标成「已返回空结果」 → 已修 |
| C | 安全与医学 | BLOCKED → 已修 | P1-1 影像分析失败被包装成成功结果；P1-2 图片 URL 先落库后校验 | 两条均已修并有回归；P2-1 日志出口一处脱敏缺口已随 P1-1 修（不再打印模型原文） |
| D | QA / 发版 | BLOCKED → 部分关闭 | 候选 SHA 未跑 CI、文档 SHA 过期、交付物未入库、`verify.sh` 结果绑定旧 SHA | 交付物已入库；文档已更正；CI 已在 `6ff5a889` 上 21/21 绿；剩余为 G-3/G-5 外部门禁（见 `release-candidate-readiness.md`；**G-3 已于 §9 关闭**，G-5 仍未关闭） |

**评审纪律说明**：Reviewer C/D 给的是 BLOCKED，不是「形式不通过」——
C 的两条是真实的医学语义与安全问题，已修；D 的阻断里「CI 未跑」当时无法在本地消除，后续已通过开 PR 关闭，
其余（文档不一致、交付物未入库、结果绑定旧 SHA）已全部关闭。
后续：CI 已在 `6ff5a889` 上跑完 21/21 全绿，D 的“CI 未跑”一项也已关闭。


## 8. Codex NO_GO 定向整改轮（2026-11-19）

审查方对 `7dc3422b`（代码 `6ff5a889`）给出 **NO_GO：2 P0 + 5 P1**。本轮在同一集成树上逐条整改，
产出新候选 **`03b14efd`**。

| 编号 | 整改提交 | 回归形态（真实执行路径） |
|---|---|---|
| P0-01 视觉工具把无效输出登记为成功 | `0e75c9f3` | 真实 `@Tool` + 真实 `ReactAgent`，四个出口断言 |
| P0-02 备份失败后仍强制删除工作树 | `29cffaac` | 临时仓库 + PATH 假 `git`/`tar` 注入失败，28 断言 |
| P1-01 超时/取消状态在回放中丢失 | `45078650` | 拦截链 + sink 落库 + 前端状态映射 |
| P1-02 半份文档成为 RAG 来源 | `2b21617c` | 第 2 批写入失败 → 清理 + 状态；读侧 readyOnly |
| P1-03 普通文本冒充受信附件 | `90a568b7` | 服务端标记 + 地址白名单，旧实现下先红后绿 |
| P1-04 回滚指引与迁移路径冲突 | `33bdf2a7` | 真 MySQL 上实测「升级后旧 jar 可启动」「不认的 history 拒绝启动」 |
| P1-05 预算耗尽静默收尾 | `c3a56ae9` | 真实图 + 真实拦截器，三种收尾 |
| CI 首轮两 job 失败 | `03b14efd` | 库名前缀与 skip 契约计数；未放宽门禁 |

- 逐条细节：`docs/release/codex-no-go-remediation.md`。
- 证据（本地三段 verify、CI 21/21、双主题断言、工作树故障注入、真实后端冒烟）：`verification-matrix.md` §2.6。
- 终态：`CONDITIONAL`——**NO_GO 是否解除由 Codex 复验决定**，自验收不能替代。

## 9. G-3 真实外部集成与 Codex 复验交接（2026-11-19）

### 9.1 G-3 已执行

上一版只有「提供方不可用时的失败出口」。本轮拿到**真实 DashScope 凭据**（取自环境变量
`DASHSCOPE_API_KEY`），在候选代码树 `03b14efd` 上跑完 5 个真实链路场景：

| # | 场景 | 关键读数 |
|---|---|---|
| G3-1 | 真模型流式问答 | 逐帧 `assistant` + `event:done`，时间戳带 `+08:00` |
| G3-2 | 真工具成功 + 真 RAG 命中 | 真 `text-embedding-v3` 向量化 → 真 ChromaDB 写 24 分块；命中 `builtin:03-cataract` **0.809** / `04-diabetes` 0.648 / `07-myopia` 0.385，终态 `succeeded`/`NONE` |
| G3-3 | 真工具失败 | `analyzeEyeImage` 传不存在的 imageId → `failed` / `TOOL_ERROR` / `TOOL_EXCEPTION`，**四出口一致**（SSE / 历史 / `t_agent_tool_audit` / 给模型的错误响应）；模型未编造影像结论 |
| G3-4 | SSE 断流 | 客户端 6s 断开（25 帧、无 `done`）→ 12s 后两个并行 `searchDocuments` 都带终态 `succeeded` |
| G3-5 | P1-03 用户文本伪装信封 | 逐字保留为纯文本、`images=null`，未合成附件 |

逐项证据、环境参数与实测读数见 `docs/release/verification-matrix.md` §2.7。

**未覆盖（如实记录）**：视觉工具**成功**路径、真实对象存储上传（占位 COS 凭据，
`qwen-vl-plus` 从未被真实调用）；运行环境不是生产拓扑；协作与临床复核开关按禁令保持关闭。

**收尾**：后端已停；schema `diagnosis_g3` 已删；Chroma collection 恢复 0 条；
Redis 只删本轮 12 个会话键（其余 5 个属其他工作树，未动）；含凭据的临时目录、
启动日志与临时脚本已删除；仓库 `git status` 干净、仓库内无凭据。

### 9.2 交给 Codex 复验

**自验收不能代替独立复验**——NO_GO 由审查方给出，也要由审查方解除。本侧不改、不覆盖
Codex 的原始结论（`D:\Work\code\iris-codex-audit-7dc3422b\docs\release\codex-independent-review.md`，只读）。

| 项 | 值 |
|---|---|
| 复验对象（代码） | `03b14efd8f9bcc8d6326a104396d8b68a30d5e8b` |
| 复验对象（当前 head） | 以 PR #119 的 head 为准（2026-11-19 为 `eb21acc7`）：`03b14efd` + 1 个**测试夹具**提交 `534108b0`（见 §10），其余只改 `docs/**`；`git diff 03b14efd HEAD -- src/main` 为空 |
| 候选 PR | #119（**仍为 Draft**） |
| 逐条台账 | `docs/release/codex-no-go-remediation.md`（每条含根因 / 改动 / 提交 / 回归用例） |
| 逐 SHA 证据 | `docs/release/verification-matrix.md` §2.6（工程门禁）、§2.7（G-3 外部集成） |
| 已知偏差 | P1-04：审查报告推断「升级后旧 jar 无法启动」，**实测相反**（可启动，V18–V28 为 `FUTURE_SUCCESS`）；台账按实测记录，审查结论未被修改 |
| 请复验方判定 | 7 条是否全部关闭；P1-04 偏差是否接受；G-5 截图证据是否成立 |

复验方可用的复跑入口（都在候选树上）：

- `scripts/verify.sh`（本地全量三段）
- `mvn -Dtest=FlywayMySqlIntegrationTest test`（P1-04 的 5 条真实 MySQL 用例）
- `mvn -Dtest=EyeImageAnalyzerToolOutputValidationTest,AgentEyeImageInvalidOutputEndToEndTest test`（P0-01）
- `mvn -Dtest=ToolFailureCategoryTest,AgentBudgetExhaustionTest test`（P1-01 / P1-05）
- `mvn -Dtest=DocumentProcessingServiceChunkRollbackTest,DocumentSearchToolReadyOnlyTest test`（P1-02）
- `mvn -Dtest=ChatHistoryServiceUserMessageTest test` + `web/` 的 `agentStream` / `agentResources` / `UserMessage` 用例（P1-03）
- `bash scripts/tests/worktree-hygiene-failclosed.sh`（P0-02）
- 真实外部链路（G3-1…G3-5）：环境参数见 `verification-matrix.md` §2.7；凭据走环境变量，
  仓库外临时配置目录注入，跑完须清理临时 schema / Chroma 分块 / 会话键 / 临时目录

## 10. 不稳定测试治理：`processDeathRestoresOnlyCommittedNodesAndPreservesBudgets`（2026-11-19）

上一轮本地全量 `scripts/verify.sh` 的 pass 3 在这条参数化用例上失败过一次
（`done:151->await:157 Bounded condition did not become true`，即恢复后始终未到终态）。
本轮按 §7.3 的要求先定位、再按「同一轮内量基线」的方式修，没有调大任何断言超时。

### 10.1 复现

一次性 MySQL 8.0.26（`:33309`）+ Redis（`:36381`）+ 隔离 schema `graph_execution_test`，
单独复跑该方法：**8 次尝试中 4 次失败**，失败点固定在第 6 个场景
`JOIN:EXHAUSTED_BUDGET`，症状与全量跑一致（`done()` 10s 内未观测到终态）。

### 10.2 根因（有实测读数，不是推断）

在 `PatientDraftCoordinator.claim()` 的各条 `return null` 分支加临时探针后抓到：

```
CLAIM-NULL lease hostUtc=2026-11-19T06:40:25.317Z
  dbNow=2026-11-19 06:40:22.024757
  leaseUntil=2026-11-19T06:40:22.391446   fencingToken=1
```

- 夹具在拉起恢复子进程前写 `leaseUntil=TIMESTAMPADD(SECOND,-1,NOW(6))`，**按夹具自己的
  算术**这条租约已过期 1 秒。
- 但子进程读到的数据库时钟是 `06:40:22.02`，而 `leaseUntil=06:40:22.39` ——
  **按数据库时钟租约仍然有效 0.37 秒**。`takeLease` 遂返回 null，`claim()` 按设计不领取，
  恢复没有发生；`done()` 的 10 秒有界等待到点失败。
- 同一轮内量到的宿主机↔数据库偏移：本场景第一个子进程 `host−db = 0.77s`，两秒后第二个
  子进程变成 `3.30s` —— 宿主机时钟没有回拨，是 **MySQL 容器（Docker Desktop / WSL2 VM）
  的时钟在这 2 秒内向后步进了约 2.5 秒**。相邻场景的偏移在 0.77–3.30s 之间漂移，
  说明这台机器上 VM 时钟被时间同步反复步进，而不是一次性偏差。

**结论**：协调器行为正确（租约只认数据库时钟，这正是它防客户端时钟偏移的设计），
缺陷在测试夹具的前提——它假定「父进程写进去的过期时间在同一轮内一直成立」。

### 10.3 修复

`GraphExecutionTest.RecoveryWorker` 在领取前，用**与协调器相同的权威**
（`SELECT leaseUntil>CURRENT_TIMESTAMP(6)`）有界等待租约真正过期（上限 8s），再调用
`coordinator.run()`。

- 没有放宽任何断言：`done()` 仍是 10s，`await(...)` 仍是 10s，场景断言逐条未改。
- 有界：若时钟步进超过上限（或租约确实仍被持有），测试照样失败，只是失败原因变得可读。
- 语义未削弱：等待期间没有任何模型调用、没有任何状态写入；恢复仍是「一次领取」，
  不是靠重试堆出来的通过。生产侧的对应事实是 `CollaborationRunService.recoverPending()`
  每 250ms 扫一次，时钟步进只会让恢复晚几百毫秒，不会丢恢复，也不会造成二次提交
  （`fencingToken` + `checkLease` 挡住陈旧执行者）。

### 10.4 验证

| 项 | 结果 |
|---|---|
| 修复前单独复跑该方法 | 8 次尝试 **4 次失败** |
| 修复后单独复跑该方法 | 8 次尝试（64 个场景）**8/8 全绿** |
| 全量 `scripts/verify.sh`（`534108b0`） | ✅ `verify green`：pass1 `751/0/0`（303 skip 按设计）、pass2 `9/0`、pass3 `303/0` |
| CI（run 44476142935，`534108b0`） | ✅ **21/21**。首次跑次 `backend-unit` 因 Maven Central 解析不到 `surefire-junit-platform:3.5.4` 失败（无断言失败），`gh run rerun --failed` 后全绿；未改代码、未放宽门禁 |
| CI（run 44477715234，文档 head `eb21acc7`） | ✅ **21/21**。同样先撞 `surefire-junit-platform:3.5.4` 解析失败（`product-contract` / `issue22-mysql`，无断言失败），重跑后全绿；同一时刻该构件在 Central 返回 200 |

### 10.5 残余风险（如实记录）

- 租约本身仍是**壁钟**语义。数据库时钟若向后步进超过租约时长（10s），恢复会被推迟
  相应时长；向后步进不会造成重复提交，向前步进由 fencing token 兜住。
- `JOIN:DEADLINE` 场景里 `deadlineAt` 由数据库时钟写入、由 JVM 的 `clock.instant()` 比较；
  本机数据库时钟**落后**宿主 1–3 秒，只会让「已过期」判定更早成立，故本轮未观察到它抖动。
  若将来出现数据库时钟**领先**宿主的机器，这条用例需要按同一方法处理。

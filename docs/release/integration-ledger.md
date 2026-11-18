# Iris 发版集成台账（Integration Ledger）

> 本轮集成的唯一记录处。每完成一批就更新，不依赖对话记忆。
> 起始时间：2026-11-18 晚；最后更新：2026-11-19 02:20（+08:00）。

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
| D | QA / 发版 | BLOCKED → 部分关闭 | 候选 SHA 未跑 CI、文档 SHA 过期、交付物未入库、`verify.sh` 结果绑定旧 SHA | 交付物已入库；文档已更正；CI 仍是外部门禁（见 `release-candidate-readiness.md`） |

**评审纪律说明**：Reviewer C/D 给的是 BLOCKED，不是「形式不通过」——
C 的两条是真实的医学语义与安全问题，已修；D 的阻断里只有「CI 未跑」无法在本地消除，
其余（文档不一致、交付物未入库、结果绑定旧 SHA）已全部关闭。

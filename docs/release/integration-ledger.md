# Iris 发版集成台账（Integration Ledger）

> 本轮集成的唯一记录处。每完成一批就更新，不依赖对话记忆。
> 起始时间：2026-11-18 晚；最后更新：2026-11-19 00:35（+08:00）。

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

## 4. 尚未关闭

| 编号 | 项 | 级别 | 状态 |
|---|---|---|---|
| O-1 | #101 / 清理类 PR 尚未合入 | 批次未做 | 进行中 |
| O-2 | 完整后端全量验证（`scripts/verify.sh`） | 门禁 | 运行中，见 `verification-matrix.md` |
| O-3 | 真实后端链路（SSE / 工具失败 / 权限隔离） | 门禁 | 未执行 |
| O-4 | 四路独立 Review（A/B/C/D） | 门禁 | 未执行 |
| O-5 | 发布说明、升级/回滚手册 | 交付物 | 未开始 |

## 5. 边界

- 不合并到 `ui` / `master`，不打 tag，不部署 —— 需 owner 批准。
- 不修改冻结 tag，不删除历史证据脚本。
- 冻结范围内（首页/品牌层、管理端、知识库、新闻工作台）不做视觉迭代；
  #102 因此推迟。

# Iris R5 · 最终就绪报告（进行中）

> 状态：**进行中**。本文件按轮次追加，未完成的条目明确标 `TODO`，不预先写结论。
> 任务书：`C:\Users\yuwen\AppData\Local\Temp\iris-r5-task-20261118.md`（本轮口径）。

## 1. 分支与 PR 拓扑（2026-11-18 09:0x 实测）

| PR | 分支 | Base | HEAD | 状态 |
|---|---|---|---|---|
| #98 | `fix/r3-agent-send-rollback` | `ui` | `70e4379e` | Draft，已推送 |
| #99 | `feat/r5-storage-privacy` | `ui` | `bdd1f326` | **新建** Draft |
| #100 | `feat/r5-clinical-semantics` | `feat/iris21-multiagent-integration` | `30d7c7c0` | **新建** Draft |
| #87 | `feat/iris21-multiagent-integration` | `ui` | `9a6dbcb6` | Draft，未动 |
| #92–#97 | — | `ui` | — | 已合并，`ui` tip = `6893a5d1` |

冻结 tag `iris-ui-v2.1-freeze-20261115` → `80f53f7f`，**未移动**。

## 2. Phase 0 · 基线

- `git fetch --all --prune` 后 `origin/ui` = `6893a5d147…`，与任务书参考值一致。
- PR #98 head = `25dd31cf…`，PR #87 head = `9a6dbcb6…`，均与参考值一致。
- 工作树：主检出 + 24 个既有工作树；本轮**未新建**工作树，全部在主检出上串行操作。
- 主检出起始分支 `local/r3-joint-20261118` @ `1c40027e`（干净），切换前已记录。

## 3. Phase A · #98 Agent 可靠性

### A1 · 发送结果语义

**根因**：`AgentController` 在校验归属之后、返回 `Flux` 之前**同步**落库用户消息；
因此「有没有助手内容」既不能证明发出去，也不能证明没发出去。原实现在
`prev.length > index + 1` 上做判断，最坏情况是「界面没有提问、服务端有记录」。

**改法**：把真实信号传上来。

| 层 | 改动 |
|---|---|
| `lib/api.ts` | `StreamChatHandlers.onAccepted`，`onopen` 通过状态码与 content-type 校验后回调 |
| `lib/agentStream.ts` | 失败抛 `AgentSendError{accepted, cause}`；`StreamMessage.delivery` 四态 |
| `pages/AgentPage.tsx` | `sending → accepted / unconfirmed → failed`；未确认时 `getChatHistory` 核对**只读不重发** |
| `components/agent/messages/UserMessage.tsx` | 仅「不一定有这条」时显示读数 |
| `styles/agent.css` | `.agent-msg__delivery` |

**六态映射**（任务书 A1 要求）：

| 任务书状态 | 本实现 |
|---|---|
| 明确未发出 | 上传失败/互斥拦截：从未调用 `send`，不推气泡 |
| 已确认服务端受理 | `onAccepted` → `delivery: accepted` |
| 受理状态未知 | `delivery: unconfirmed` + 历史核对 |
| 正在生成 | `isStreaming` + `sending` |
| 已完成 | 流正常结束 → `accepted` |
| 已失败或已取消 | `failed`（核对确认服务端没有）/ 用户「停止」走 abort，气泡保留 |

### A2 · 账号切换竞态

- `getSessions()`：请求序号 + 发起身份双校验。
- `getChatHistory()`：序号 + 线程 ref + 身份 + 「期间有无新用户轮次」四重校验。
- 旧账号响应**不会**写回当前 UI；历史晚到不会覆盖刚发出的消息。

### A3 · Hook 级测试

新增 `src/lib/agentStream.hook.test.tsx`（5 例）：受理信号 true/false、abort 闸门、
abort 清光标、reset 清态、StrictMode 双挂载。

页面测试改为断言「保留气泡 + 标记未确认」与「核对到服务端已有 → 不提示」。

**未覆盖（如实登记）**：真实网络中断后的恢复（只有 mock）；`onAccepted` 在真实
Spring SSE 上的行为未做端到端验证（需要后端联调，见 §7）。

### A4 · 门禁

```
npx tsc -b --noEmit        → 通过
npx eslint src --max-warnings=0 → 通过
npx vitest run             → 67 文件 / 617 例通过
```

Playwright：TODO（下一轮跑 `/agent` 相关 spec）。

## 4. Phase C · 存储与隐私（PR #99）

### C1 · C-12 提交歧义

`doDiagnosis` 无事务，`save()` 自动提交。原实现落库抛异常即删刚上传的对象——
若提交其实已生效，会删掉一条正式记录引用的原图。

新的判定：按主键回查 → 查到：**保留对象**；明确查不到：补偿删除；
回查本身失败：按「可能存在」处理，**不删**。

**已有补偿系统复用评估**：`upload/state/UploadCompensationService` 按 `agent-chat/`
前缀管理 Agent 聊天图片，依赖 `t_upload_task` 状态机与定时对账。用于判读影像需要
放宽状态机 + 迁移 → 属于「先写 ADR + 独立数据库评审」的范围，**本轮不复用**。
本修复的形状（objectKey + 可回查的持久状态）与将来 S3 兼容抽象一致。

**未做**：outbox / 幂等键 / 迁移。**未验证**：真实驱动层面的提交超时（只有单测替身）。

### C2 · 隐私

| 项 | 改动 | 回归 |
|---|---|---|
| D-03 密码哈希 | `User.userPassword` 加 `@JsonIgnore` | `DiagnosisPrivacyTest`：实体序列化、`/user/get` |
| D-04 判读缓存 | `DiagnosisController` `@ModelAttribute` 统一 `no-store` | 同上：响应头断言 |

**门禁**：

```
mvn -o -Dtest=DiagnosisPrivacyTest,DiagnosisUploadReliabilityTest test
Tests run: 3 + 9, Failures: 0, Errors: 0
```

## 5. Phase B · 医疗语义（PR #100，后端切片）

新增 `GET /diagnosis/get/{id}` 的 `data.source`：`recordSource` / `patientTaskId` /
`draftReviewState` / `authorizationState` / `authorizedAt` / 回执前缀 / `imageArchivalState`。

- 只在 `getOwnedDiagnosis` 之后下发；列表接口不带。
- 查询失败 → `UNKNOWN`，不退化成「未授权 / 未归档」。
- 不改 `humanReviewStatus` 取值域，不写表。
- 测试：`DiagnosisSourceProjectionServiceTest` 6 例通过。

### D-01 / D-06 / D-01b 状态

| 项 | 状态 | 说明 |
|---|---|---|
| D-01 患者授权 ≠ 临床复核 | **部分关闭（后端）** | 投影已能分开陈述；前端渲染未做 |
| D-06 影像归档来源 | **部分关闭（后端）** | 四态投影已实现；`ARCHIVED_NOT_PUBLIC` 只陈述访问策略，不陈述对象可回放 |
| D-01b 复核主体身份 | **BLOCKED（医学/产品）** | 系统无 `doctor` 角色开通制度，授予临床复核权不是我能在夜间决定的。最小方案：保留管理端写路径，但把「REVIEWED = 医生已完成人工复核」改成「已由具备复核权限的账号完成人工复核」，并把资质制度单列为门禁 |

## 6. Phase D · 联合候选

TODO（A/B/C 可执行项完成后再建）。

## 7. Phase E · 独立审查

TODO。

## 8. 未关闭风险

| 级别 | 项 | 现状 |
|---|---|---|
| P1 | D-01b 复核主体 | BLOCKED，等角色模型决定 |
| P1 | D-01/D-06 前端渲染 | 后端已就绪，前端未改 |
| P1 | E-09 冻结首屏替换（#87 线） | 等冻结 owner 签字 |
| P2 | B-04' 刷新后工具五态退化 | 未改；当前展示「未确认」不虚构，但五态承诺在恢复路径不成立 |
| P2 | C-08 `doctor` 角色无开通路径 | 未改 |

## 9. 结论（进行中，勿引用）

#98 建议合并（Agent 可靠性，前端门禁全绿）。
#99 建议评审后合并（隐私两项可直接生效；C-12 是保守化，不改变可见行为）。
#100 仍为后端切片，前端未接，**不建议合入 #87**，直到 §5 的前端与 D-01b 有结论。

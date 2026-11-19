# 合并就绪报告（PR #119 → `ui`）

> 本轮任务：接管 Codex 未完成的工作，把 PR #119 推进到 **MERGE_READY**。
> 本报告只记录**可核对的事实**；结论按证据给，不按期望给。
> **不合并 PR #119**——合并与否由 owner 决定。

## 0. 一句话结论

**`MERGE_READY / PENDING_INDEPENDENT_REVIEW`**（自验通过，独立复审结论见 §6）。
6 条仍开放阻断逐条整改并有可复跑证据；本地三段全量与 CI 门禁见 §4；
G-3 原始证据未留存、G-5 截图证据仍缺——这两项**不阻断合并**，阻断的是对外宣称「真实集成已通过」与临床启用。

## 1. 分支与提交

| 项 | 值 |
|---|---|
| 工作树 | `D:\Work\code\eye-diagnosis\.worktrees\integration-rc` |
| 分支 | `integration/iris-release-candidate` |
| 基线 | `438aa60c3918cd77803cd969275b35f7984ace28`（`origin/ui@1ff9c71c` 之上的既有集成提交） |
| 本轮起点 | `c0047093`（Codex 已提交、未推送的归档安全整改） |
| 本轮代码 HEAD | `f6b08841` |
| 本报告所在提交 | 见 `git log -1`（只改 `docs/**`） |
| 推送方式 | 普通 fast-forward（`438aa60c..f6b08841`），**未 force push、未 rebase 共享历史** |

### 1.1 本轮提交（按主题）

| 提交 | 主题 | 对应阻断 |
|---|---|---|
| `c0047093` | 删除前验证归档可恢复与内容未变化（接管前已提交） | P0-02 |
| `623c9d57` | 工具终态先提交再发送，取消与中断不再记为超时 | P1-01、P1-05（同文件） |
| `50a00205` | 文档索引版本作用域（V29），失败代与旧代向量不再作为来源 | P1-02 |
| `04041575` | 附件身份移到服务端字段，历史读取按当前用户复核 | P1-03 |
| `9ad4f421` | 终态持久化用例接入三段验证与 surefire 契约 | P1-01 证据可执行化 |
| `f6b08841` | 工作树夹具钉死 `autocrlf`（不改任何断言） | P0-02 夹具 |

## 2. 接管记录

- 接管时工作树里有**大量未提交改动**（Codex 的六条整改在半完成状态，含编译错误）。
  先以**悬挂提交 ref** 完整备份，再在**同一工作树**内继续，未新建工作树、未清理其他 Agent 的工作树。
- 未使用 `git reset --hard` / `git clean -fd` / `git checkout -- .` / 未验证的 stash。
- 接管后修复的「中间态」问题（都是并行子任务之间的契约不一致，不是放宽门禁）：
  1. `MessageVO` 构造器参数个数与 Lombok 生成的不符 → 编译失败；
  2. `ChatHistoryServiceUserMessageTest` 的 `Callable<Object>` 与实现签名不符；
  3. 同一用例仍验证 4 参 `writeUserMessage`，实现已是 5 参（带 `subType` + 雪花 id）；
  4. 图片引用负例仍用旧 COS 形态，而上传接口已改为返回受保护取图路径 → 两条断言变成空转；
  5. 前端 `ResourcePanel` / `agentStream.hook` 夹具仍写旧 COS 地址；
  6. `check_surefire_skips` 的 flyway 契约缺新用例计数；
  7. 工作树故障注入夹具受宿主 `core.autocrlf=true` 影响，把「正确 fail-closed」误判为用例失败。

## 3. 六条阻断逐条状态

| 编号 | 结论 | 实现位置 | 回归证据 |
|---|---|---|---|
| P0-01 | **CLOSED（未回退）** | `EyeImageAnalyzerTool` 严格解析 + `INVALID_OUTPUT` | 既有 13 + 2 条用例仍绿 |
| P0-02 | **已整改（自验通过）** | `scripts/worktree-hygiene.sh` | 87 断言 / 12 例，含 4 种「不得删除」反例 |
| P1-01 | **已整改（自验通过）** | `MCPManager` / `ToolStepSink` / `SessionMessageQueue` / `agentStream.ts` | `ToolTerminalCommitTest`、`McpTerminalCategoryTest`、`ToolTerminalPersistenceMySqlIntegrationTest`（真实 MySQL 注入写失败）、`ThoughtLine.terminal-wire.test.tsx` |
| P1-02 | **已整改（自验通过）** | `DocumentProcessingService` / `DocumentSearchTool` / `DocumentSearchTool#validateResourceRefs` / V29 | 4 个用例 + 真实 Chroma 探测器 |
| P1-03 | **已整改（自验通过）** | `ChatHistoryService` + `subType` 列 + `/api/agent/image/view/*` + `agentResources.ts` | `AgentAttachmentTrustTest` 3 例 + 前端 4 处 |
| P1-04 | **已整改（文档 + 实测用例）** | `upgrade-rollback-manual.md` §1/§2/§4、`migration-matrix.md` §2.1 | `FlywayMySqlIntegrationTest` 5/5（含改名后的迁移解析用例） |
| P1-05 | **已整改（自验通过）** | `DiagnosisAgent#closingNotice` + `CountingChatModel` | `AgentBudgetExhaustionTest`（新增铺垫后请求工具场景）、`ToolTerminalPersistenceMySqlIntegrationTest#verifyBudgetTurn` |

逐条根因 / 改法 / 证据见 `codex-no-go-remediation.md` §9。

## 4. 验证结果

### 4.1 本地（代码树 `f6b08841`）

| 门禁 | 结果 |
|---|---|
| `scripts/verify.sh` pass 1/3（完整 `mvn test`） | ✅ `762 / 0 / 0`（303 skip 按设计） |
| pass 2/3（MySQL 集成门禁，含新终态持久化用例） | ✅ `10 / 0 / 0` |
| pass 3/3（隔离库协作套件） | ✅ `303 / 0 / 0` |
| 收尾 | ✅ `verify green`，`EXIT=0` |
| Web 单测（串行） | ✅ 97 文件 / 1039 用例 |
| Web 类型 / Lint / 构建 | ✅ 全部 exit 0（仅大 chunk 提示） |
| 工作树归档故障注入 | ✅ 87 断言 / 12 例 |

### 4.2 CI

| head | run | 结果 |
|---|---|---|
| `f6b08841` | [44504778424](https://github.com/yuwen773/eyes-diagnosis/actions/runs/44504778424) | ⚠️ **20/21**：`docs-contract` 失败——`check_steering_docs.py` 抓出 `CLAUDE.md` 仍写 V28 而迁移已到 V29（新增迁移没同步项目说明）。**这是真缺陷，已修**（本报告所在提交），本地同一门禁复跑通过。失败 attempt 保留不重写 |
| 本报告所在提交 | 推送后补记 | 只改 `docs/**` 与 `CLAUDE.md`，不改变代码树 |

### 4.3 与第二轮审查基线的差异

第二轮审查在同一三段上得到 `751 / 9 / 303`，本轮 `762 / 10 / 303`：
差额全部来自新增用例，**没有删除、跳过或放宽任何既有断言**。

## 5. 未关闭门禁（本报告不宣称通过）

| 项 | 状态 | 影响 |
|---|---|---|
| G-3 真实 DashScope 原始证据 | ❌ 未留存 | 上一轮的 5 场景结论无法被独立交叉核验，只作自述；真实视觉成功路径与真实 COS 上传从未执行 |
| G-5 双主题/响应式截图 | ❌ 仍 OPEN | 断言式门禁已跑（对比度/版式），截图证据未复核 |
| 独立复验（原 R-1） | ⏳ 见 §6 | 自验不能代替独立复验 |
| 真实临床能力 | ❌ 未评估 | 工程门禁通过 ≠ 疗效/安全性结论 |

## 6. 独立交叉复审

（本节由独立复审子代理的结论回填；在回填前本报告的终态是
**`SELF_VERIFIED / PENDING_INDEPENDENT_REVIEW`**，不是 `INDEPENDENT_PASS`。）

## 7. 需要 owner 批准的动作

1. **合并 PR #119 到 `ui`**（本轮禁止执行；PR 仍为 Draft）。
2. 合并后是否进入部署窗口；部署前须按 `upgrade-rollback-manual.md` §3 冒烟。
3. G-3 复查：是否提供可用的 DashScope + COS 凭据以重跑真实链路并**保留脱敏证据**。
4. G-5：是否接受当前断言式门禁替代截图证据，或要求重出截图。
5. 切换任何生产临床开关（正式复核写入、多 Agent 协作）——本候选一律保持关闭。

## 8. 本轮明确没有做的事

- 未合并 PR #119，未改 `ui` / `master`，未 force push / rebase，未移动冻结 tag。
- 未重启全仓 PR 集成，未新建工作树，未清理其他 Agent 的工作树。
- 未删除有价值的未提交代码：接管前的 WIP 已全量备份为悬挂提交 ref。
- 未部署、未开启任何生产临床能力。

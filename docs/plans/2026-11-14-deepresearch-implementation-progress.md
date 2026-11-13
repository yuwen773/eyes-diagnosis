# TASK-11 · DeepResearch 工程能力借鉴落地进度

日期：2026-11-14 · 工作树 `realtime-product-acceptance` · 分支 `codex/realtime-product-acceptance`
基线 HEAD：`7c028b80d3c77d4e955856cc2740998aea4ecc4c`（PR #68 head；本任务**不合并**）
循环：每 10 分钟 · 每轮先读本文件 + `git status` + `git log`。

## 0. 约束（每轮复述）

- 不创建新 worktree、不切 master、不合并 PR #68、不部署、不启用医疗协作、不调用真实模型、不使用真实患者数据、不删未跟踪报告、不覆盖 R5 封存证据。
- 新增功能改变 PR #68 已审查代码树 → 之前 `MERGE_READY` 结论失效，完成后必须标记「需要新的最终合并审查」。
- 写入只由主会话串行执行；子代理只读。
- 新增 Flyway 只能 V28+，不动 V1–V27。
- 普通聊天 SSE / 协作 16 事件 / 默认关闭 / R5 封存哈希 必须保持兼容。

## 1. 当前阶段

`ROUND 3 — A1/A2 已提交（commit 1），开始第二批 B1/B2 源码审查`。
下一轮目标：提交 commit 1，然后开始第二批 B1（严格格式重试，默认关闭）与 B2（来源类型分层）。

## 2. 已读文档（基线）

- `docs/plans/2026-11-13-pr68-final-merge-review.md`（上一轮结论，代码 MERGE_READY / 生产启用 BLOCKED）
- `docs/plans/2026-11-13-deepresearch-borrowing-review.md`（6 BORROW / 6 CONSIDER / 15 SKIP）
- `docs/architecture/studio-reuse-decision.md` §5/§8（不引 Mermaid、不新增后端端点）
- `AGENTS.md`、`CLAUDE.md`、`web/DESIGN.md`（经子代理 survey）
- 核心源码：`MessageDTO.java`、`MessageType.java`、`DiagnosisAgent.java`、`ChatHistoryService.java`、`ChatMessageWriter.java`、`AgentMessage.java`、`AgentMessageMapper.java`、`web/src/lib/agentStream.ts`、`web/src/lib/api.ts`、`web/src/components/agent/messages/ToolRequestMessage.tsx` / `ToolResponseMessage.tsx`、`AgentPage.tsx` 导出段。

## 3. 实测结果（本轮，全绿）

| 门禁 | 结果 |
| --- | --- |
| `mvn -o -DskipTests compile`（离线，JDK21） | 通过 |
| 新增后端单测 `ToolStepContractTest` / `ToolAuditServiceTest` / `DiagnosisAgentRedactionTest` | **20/20 通过**，0 failure / 0 error |
| 真实 MySQL 8.0（3307）`FlywayMySqlIntegrationTest` / `UploadTaskMapperMySqlIntegrationTest` / `ToolAuditMySqlIntegrationTest` | **7/7 通过**（空库 → V28、master V17 → V28、V23→V24、上传 CRUD、V28 表结构与 owner 过滤） |
| `scripts/verify.sh -q -B`（一次性 MySQL 8 + Redis，两遍） | **verify green**；pass 1 含 `contextLoads` 通过，pass 2 三个集成 suite 全通过 |
| `web`: `npm run typecheck` / `npm run test` / `npm run lint` / `npm run build` | typecheck 0 错；**349/349 Vitest**；lint 通过；build 成功 |
| `check_collaboration_fixture.py --backend-root .` | 16 event types / 12 snapshot fields |
| `check_steering_docs.py .` | V28 head 与 controller paths 一致 |
| `check_surefire_skips.py target/surefire-reports backend-unit` | 无意外 skip / dropped test |
| `python -m unittest discover -s scripts/tests -p "test_check_*.py"` | **36/36 OK** |
| `collect_product_acceptance.py --verify-baseline` | `VERIFIED / evidenceFiles 18 / experimentClosed true` |

`mvn -o test` 不带 DB 时 `contextLoads` 会因 Studio `agentController` 重名（无 profile）或 `eyeuser@3306` 拒绝（ci profile）失败——这是已知环境前提，故全量验证走 `scripts/verify.sh`（与 CI 编排一致），不是代码回归。

## 4. 关键源码事实（主会话独立复核）

1. **A2 原缺陷已修**：旧 `DiagnosisAgent` 把 `toolCall.name() + ": " + toolCall.arguments()` 写进 `t_agent_message.content`，参数原文（可能含患者信息/密钥）落库。现改为只写固定白名单标签 `ToolStepContract.stepLabel(name)`；工具确认卡落库也不再写模型生成的评估描述。
2. SAA 1.1.2.2 `AgentToolNode.executeToolCallWithInterceptors` 对**每个**工具调用（含 `methodTools`）都走 `chainToolInterceptors` → `ToolInterceptor.interceptToolCall`，`ToolCallRequest.getToolCallId()` 来自 `AssistantMessage.ToolCall.id()`（`javap` 实测）。这是 A1 完成态的真实执行来源，不依赖 `StreamingOutput` 猜测。
3. `MessageType` 早有 `TOOL_RESULT("tool-result")` 但后端从未发送；本轮复用它承载状态增量，**不新增 SSE 事件名**，也不碰协作 16 事件契约。
4. `MessageDTO` 加 `@JsonInclude(NON_NULL)`：旧事件序列化后不出现新的 null 键，普通聊天 SSE 帧对老客户端保持兼容（针对性单测验证）。
5. 迁移目录基线 22 个（V1–V9 + V15–V27）；本轮新增 V28 共 23 个。V1–V27 未改动。
6. C1 现状：后端 `GET /agent/history/{sessionId}/export` 返回 `BaseResponse<String>`（非附件、无 Content-Disposition、format 无白名单、有 owner 校验）；前端 `safeFileName`/`downloadText`/`handleExport` 已存在但净化不完整（控制字符、前后点/空格、Windows 保留名、长度）、MIME 缺 charset、无 format 校验、无导出专用测试。
7. B2 现状：向量库元数据只有 `ownerUserId`（私有=userId / 内置=0）、`docId`、`documentId`、`corpus`；过滤表达式 `ownerUserId == <id> || ownerUserId == 0`；**无 sourceType**。受控引用库是独立 `JdbcTemplate` 路径，与 `t_patient_authorization` 互不相关，B2 不得碰这两条。

## 5. 设计决定（A1/A2 已落地）

### A1 工具状态契约（IMPLEMENTED）
- 固定状态机 `awaiting-confirm / running / succeeded / failed / cancelled`；`stepLabel` 只来自 `ToolStepContract.LABELS` 白名单，未知工具统一「调用工具」。
- 每个请求独立 `ToolStepSink` + `ToolExecutionInterceptor`（注册到 `ReactAgent.Builder.interceptors`）：`started` 在真实拦截时、`finished` 只在 `handler.call()` 返回/抛异常后发出。TOOL_REQUEST 与 assistant 文本绝不推断成功。
- `toolCallId` 精确关联；前端 `applyStreamEvent` 按 id 就地更新对应卡，状态先到时补匿名卡；并发卡不串台。
- 断流 / 错误 / 用户取消：后端 `sink.closePending()` 把无真实结果的调用标 CANCELLED（含审计行），前端 `markPendingToolsCancelled` 兜底，绝不出现虚假成功。
- `ToolRequestMessage.tsx` 用 `role="status"` + `aria-live="polite"` 显示状态文字，颜色永远与文字配对；CSS 用现有 risk tokens，明暗主题与移动端均有规则。
- 不修改 `CollaborationEvents` 16 事件契约；复用 `TOOL_RESULT` 消息类型。

### A2 结构化审计（IMPLEMENTED，默认关闭持久化）
- `V28__agent_tool_audit.sql`：`t_agent_tool_audit`（auditId, sessionId, userId, toolCallId, toolName, toolStatus, errorCategory, startedAt, finishedAt, argsDigest, argsKeyNames）。**没有任何可存原始参数/Prompt/患者文本的列**（集成测试断言）。
- `ToolAuditService.record()` 默认 `agent.tool-audit.enabled=false`：SSE 状态始终可用，但不落库。启用需 V28 表 + `AGENT_TOOL_AUDIT_DIGEST_KEY`。
- 参数摘要 = **HMAC-SHA256 over 排序后的 JSON 键名**（值完全不参与、不落库、不进日志），防低熵值反查；`digestKey()` 对空配置 fail-closed 返回开发默认字节，不会 NPE 打断聊天。
- `listOwned` / `summarizeOwned` 都先 `assertOwner(sessionId,userId)`，SQL 也带 owner 过滤，limit 上限 500；跨用户负例测试覆盖。
- `t_agent_message` = 用户可见历史；`t_agent_tool_audit` = 安全审计，两者分离。不引入 OTel/Langfuse/云端遥测。

### 同步点（V28）
`CLAUDE.md`（head V28 + 新增表名）、`docs/architecture/migration-matrix.md`、`FlywayMySqlIntegrationTest`（`28` / `11 migrations` / 表清单）、`scripts/check_surefire_skips.py` 两个契约、`scripts/tests/test_check_surefire_skips.py` 两个夹具、`.github/workflows/verify.yml`（`-Dtest` 列表 + `diagnosis_ci_audit_%` grant）、`scripts/verify.sh`（pass1 排除 / pass2 纳入）、`application.yml`（显式默认关闭）。

## 6. 已实现功能及提交

**Commit 1 `eb04b18`** — `feat(agent): 落地普通聊天工具步骤状态与结构化审计`（27 文件，+1584/-52）。A1 + A2 全部代码、测试、V28 迁移、CI/文档同步已入库；留在当前分支，未 push、未合并、未部署。

涉及文件：
- 新增：`ToolStepContract.java`、`ToolStepSink.java`、`ToolExecutionInterceptor.java`、`ToolAuditService.java`、`AgentToolAudit.java`、`AgentToolAuditMapper.java`、`V28__agent_tool_audit.sql`、`ToolStepContractTest.java`、`ToolAuditServiceTest.java`、`ToolAuditMySqlIntegrationTest.java`、`DiagnosisAgentRedactionTest.java`
- 修改：`DiagnosisAgent.java`、`MessageDTO.java`、`FlywayMySqlIntegrationTest.java`、`application.yml`、`CLAUDE.md`、`migration-matrix.md`、`check_surefire_skips.py`、`test_check_surefire_skips.py`、`verify.yml`、`verify.sh`
- 前端：`web/src/lib/api.ts`、`web/src/lib/agentStream.ts`、`web/src/lib/agentStream.test.ts`、`web/src/components/agent/messages/ToolRequestMessage.tsx`、`web/src/styles/agent.css`

## 7. 失败及修复（本轮实录）

1. `ToolExecutionInterceptor` 首次编译失败：父类 `Interceptor` 有抽象 `getName()`。补 `"iris-tool-step-observer"` 后通过。
2. 合并流终止设计错误：最初把 `sink.complete()` 放在 `Flux.merge(...).doFinally`，但 `statusEvents` 未关闭时 merge 不会终止 → 循环等待。改为由 `graphEvents` 的 `doOnComplete/doOnError/doOnCancel` 调 `sink.closePending()`。
3. 并发/取消竞态：pending 集合原放在 `DiagnosisAgent` 的 flux `doOnNext` 里，且把标签误当工具名。重构到 `ToolStepSink` 内部 `ConcurrentHashMap`，`closePending()` 原子输出 CANCELLED 并关闭 sink。
4. 前端 reducer 两个测试失败：一处是测试索引写错（assistant chunk 位于两张卡之间），一处是真缺陷——带 `toolCallId` 但状态非法的 `tool-result` 会降级成空的旧式结果卡。改为 fail-closed 丢弃该帧。
5. `MessageDTO` 用裸 `ObjectMapper` 序列化会把 5 个新字段写成 null，破坏旧帧形状。加 `@JsonInclude(NON_NULL)`。
6. `ToolAuditService.digestKey()` 在 Spring 之外/配置缺失时 NPE（真实健壮性缺陷）。改为空配置回退固定开发密钥字节，并加测试。
7. 本地 MySQL 用 `/?` URL 跑 `UploadTaskMapperMySqlIntegrationTest` 报 `No database selected`；改用 CI 形态 `/diagnosis_ci` 后 3/3 通过。
8. 我自己写的 GROUP BY 聚合断言错误（按 `toolName,toolStatus` 分组却断言一行 cnt=2）；改为按 `toolName` 分组断言 2。
9. `mvn -o test`（无 profile / 无 DB）`contextLoads` 失败两次，根因分别为 Studio 控制器重名和 `eyeuser@localhost` 拒绝；已确认是环境前提，改用 `scripts/verify.sh` 全绿，未改动任何测试或安全配置来掩盖。
10. 机械门禁夹具两处未同步新 suite：`test_check_surefire_skips.py` 的 backend-unit / flyway 夹具。补齐后 36/36 OK。
11. 前端 typecheck 报错：DTO 的 `toolCalls` 元素缺 `stepLabel` 字段声明。补齐类型定义后通过。

## 8. 仍未完成

B1（严格格式重试，默认关闭；预算/取消/恢复无法证明则只交 POC+测试）、B2（sourceType 分层+保守回填+fail-closed）、C1（导出规范缺口）、C2（先离线评测，无收益不启用）、第二批/第三批 commit、最终独立审查、`docs/plans/2026-11-14-deepresearch-implementation-final.md`、更新借鉴评估实施状态、hosted CI 复核、标记需要新的最终合并审查。

## 9. 下一轮可执行动作

1. 读本文件 + `git status` / `git log`；commit 1 已创建（`eb04b18`）。
2. 开始 B1：先审查现有结构化输出/Critic/预算/取消/恢复代码，写失败分类 + 故障注入测试；若无法证明预算与恢复语义，只交隔离 POC + 测试，不接运行时。
3. 并行（只读子代理）梳理 B2 的 RAG 元数据写入/检索全链路与 C1 的现有导出实现，主会话独立复核结论后再串行写入。
4. 第二批完成并验证通过后提交 commit 2；随后 C1/C2 → commit 3。

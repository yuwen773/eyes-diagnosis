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

`ROUND 5 — B1/B2 待 commit 2；C1 导出规范、C2 离线评测已实现/测试通过；下一步两个 commit 与全量回归`。

## 2. 已读文档（基线）

- `docs/plans/2026-11-13-pr68-final-merge-review.md`（上一轮结论，代码 MERGE_READY / 生产启用 BLOCKED）
- `docs/plans/2026-11-13-deepresearch-borrowing-review.md`（6 BORROW / 6 CONSIDER / 15 SKIP）
- `docs/architecture/studio-reuse-decision.md` §5/§8（不引 Mermaid、不新增后端端点）
- `AGENTS.md`、`CLAUDE.md`、`web/DESIGN.md`（经子代理 survey）
- 核心源码：`MessageDTO.java`、`MessageType.java`、`DiagnosisAgent.java`、`ChatHistoryService.java`、`ChatMessageWriter.java`、`AgentMessage.java`、`AgentMessageMapper.java`、`web/src/lib/agentStream.ts`、`web/src/lib/api.ts`、`web/src/components/agent/messages/ToolRequestMessage.tsx` / `ToolResponseMessage.tsx`、`AgentPage.tsx` 导出段。

## 3. 实测结果（按轮次记录，勿把旧绿当成新树绿）

### ROUND 2/3 — commit 1（A1/A2）基线，全绿，但改树后须重跑

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

### ROUND 4 — B1 POC + B2 增量验证

| 门禁 | 结果 |
| --- | --- |
| `mvn -q -B -o -DskipTests compile`（B2 源码 + B1 POC 均在树） | 通过 |
| `mvn -q -B -o -Dtest='SourceTypePolicyTest,DocumentSearchToolOwnershipTest,BuiltinCorpusSeederTest' test` | **17/17 通过**（6 + 5 + 6），0 failure / 0 error / 0 skip |
| `mvn -q -B -o -Dtest='FormatOnlyRetryPocTest' test` | 首轮 8/9，1 个测试夹具误把第二次调用脚本写成合法 JSON；修正夹具后 **9/9 通过** |
| `collect_product_acceptance.py --verify-baseline`（B2 改树后） | `VERIFIED / evidenceFiles 18 / experimentClosed true` |

B2 新增覆盖：显式标记识别、可信服务端元数据保守回填、`AUTHORIZED_EXTERNAL` / 跨用户 / 未知来源 fail-closed、`DocumentSearchTool` 默认关与开启后的只收窄、混合检索 BM25 缓存路径不能绕过限制、每个内置/上传 chunk 都写入 `sourceType`。B1 POC 覆盖：默认关闭、`JsonProcessingException` 仅额外重试一次、两次格式失败不再第三次、provider/timeout/safety/insufficient-citation/schema/响应形状全不重试、Critic 不重试、预算/fencing/取消/总时长、崩溃后已记账未提交不重复调用、已提交结果幂等重放、故障分类。

**B1 技术阻塞（POC_ONLY，不接运行时）**：真实运行时只有 `t_patient_draft_run.callCount` 在 `start()` 里预扣、`t_patient_draft_message` 按 `(taskId,sequence)` 记录一次逻辑调用；`docs/graph-execution.md:25-27` 明确「不是提供方调用的 exactly-once 保证」，崩溃恢复会重新消耗预算且可能重复发起。`INVALID_OUTPUT` 同时用于格式错误、响应形状、语义校验、引用不足和兜底异常，没有细粒度、可持久的 per-attempt 幂等键。要安全启用必须有新增迁移 V29+ 的 per-attempt 记账表，并把 `DraftAgents.Transport.ask` / Coordinator 的预算、取消、恢复、引用门禁一起改造；本轮按任务要求只交隔离 POC + 测试，不改 `DraftAgents` / `PatientDraftCoordinator` / `application.yml`，也不放宽任何医疗安全门禁。

### ROUND 5 — C1 导出规范 + C2 离线评测

| 门禁 | 结果 |
| --- | --- |
| `mvn -q -B -o -Dtest='ChatHistoryServiceOwnershipTest' test` | **3/3 通过**（跨用户导出拒绝、未知 format 拒绝、owner 的 markdown/json 导出） |
| `npm --prefix web run typecheck` | 通过 |
| `npm --prefix web run test` | **38 文件 / 356 测试通过**（基线 349 + C1 新测试 7） |
| `python -X utf8 scripts/evaluate_rag_query_expansion.py` | 固定 10 例：recall@5 基线 `0.25` → 扩展 `1.0`（命中 +6）；OOD/QUALITY 零 provider 调用、跨用户隔离、延迟上限、扩展数上限全 true |
| `python -X utf8 -m unittest discover -s scripts/tests -p "test_evaluate_rag_query_expansion.py"` | **5/5 OK**；连同既有离线评测共 **17/17 OK** |
| `python -X utf8 -m unittest discover -s scripts/tests -p "test_check_*.py"` | **36/36 OK** |

注意：`python -m unittest discover -p "test_*.py"` 会额外加载 `test_issue17_mysql_health.py`，它需要 `ISSUE17_MYSQL_CONTAINER` 真实容器环境变量；本轮不以该环境门禁充当脚本单元测试结果，也不跳过它来伪造绿色。CI 的 docs-contract 用的是 `test_check_*.py` 和各自固定测试文件。


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

### B1 严格格式重试（POC_ONLY，默认关闭且不接运行时）
- 新增 `src/test/java/com/.../poc/realtime/FormatOnlyRetryPoc.java` 与同名测试：纯测试范围，非 Spring bean、不改生产源码、不调真实模型。
- 失败分类只允许 Jackson `JsonProcessingException`（JSON 语法或严格 creator-property 校验）；`ScriptedModel` 注入的 provider / timeout / safety / insufficient-citation / schema / response-shape 故障一律终止。
- 共享 `Ledger` 在每次真实调用前记账，CHARGED/COMMITTED/FAILED 三态；同一 `AttemptSpec`（task/role/instructions/context/evidenceVersion/workflowVersion/fencing）重试不改变任何身份字段，CRITIC 排除。
- 崩溃后 CHARGED 未 COMMITTED 的行使新「进程」抛 `RECOVERY_PENDING`，模型调用数不增加；已 COMMITTED 的行直接重放结果。

### B2 来源类型分层（IMPLEMENTED_DEFAULT_OFF）
- `SourceTypePolicy.java`：Chroma metadata 标记 `sourceType`；`BUILTIN` / `USER_UPLOAD` / `AUTHORIZED_EXTERNAL` / `UNKNOWN`。`classify` 对存量 chunk 只用可信 `corpus=builtin` / `ownerUserId=0` / `documentId|docId + owner==caller` 保守回填；显式标记也必须有可信元数据佐证；`AUTHORIZED_EXTERNAL` 永不授予，UNKNOWN fail-closed。
- `restrict()` 只从既有 owner OR 过滤后的候选列表删除元素，绝不新增；`DocumentSearchTool` 在向量/混合融合之后、空结果与 rerank 之前调用，BM25 缓存路径同样受限。`eye-diagnosis.rag.source-type.enabled=false` 默认关闭。
- `DocumentProcessingService` 与 `BuiltinCorpusSeeder` 写入服务端派生的 `user_upload` / `builtin`，owner 仍取服务端 DB 行或系统哨兵，不接受模型输入。
- 未触碰 `ControlledEvidenceRetriever`、`t_patient_authorization`、医生复核、协作 16 事件、R5 封存证据；没有新增 Flyway，因为 Chroma 元数据不能由 SQL 回填。

### C1 会话导出规范（IMPLEMENTED）
- 保留 `GET /agent/history/{sessionId}/export` 的 `BaseResponse<String>` 契约和既有 owner/login 校验；新增 `format` 白名单 `markdown|json`，未知格式 fail-closed 返回 `PARAMS_ERROR`，不静默把 `pdf` 当 Markdown。
- 新建 `web/src/lib/sessionExport.ts` 作为 React 唯一导出实现：`safeFileName` 去控制字符/路径分隔符/首尾点空格/Windows 保留名并限长；`exportDescriptor` 生成中性文件名（只用 `会话导出` + 净化后的 sessionId，绝不拼会话标题或消息正文；标题由首条用户消息截断生成，可能含症状）、带 `charset=utf-8` 的 MIME 与 `.md`/`.json` 扩展名；`downloadText` 返回错误消息、包住 DOM 点击与 URL revoke。
- `AgentPage.tsx` 删除重复的 `safeFileName`/`downloadText`，`handleExport` 下载失败时把错误交给既有 `useFault` 路径；不改 Vue 已弃用实现，不新增 PDF 或附件端点。
- 后端 2 条导出测试 + 前端 7 条 `sessionExport.test.ts` 测试覆盖净化、标题不泄漏、MIME、下载失败、非法 envelope。

### C2 白名单多查询扩展（IMPLEMENTED_DEFAULT_OFF 的离线评测；运行时未启用）
- 新建 `scripts/evaluate_rag_query_expansion.py`、`evaluation/rag-query-expansion/corpus.json` + `results/`、`scripts/tests/test_evaluate_rag_query_expansion.py`、`docs/plans/2026-11-14-rag-query-expansion-eval.md`：零模型、零网络、零数据库、零真实患者数据的确定性离线评测。
- 受控术语仅取 8 份内置语料标题及其已有中英文别名，最多 2 条精确别名探针；原查询与 disease/site/laterality 约束始终保留，歧义 `disease=unspecified` 不扩展；复用 RRF 形状与 id 去重；owner OR 过滤后的固定命中夹具覆盖跨用户隔离。
- OOD/QUALITY 负例在检索前直接终止，baseline 与 expanded 两种模式均 `providerCalls=0`；受控证据准入、引用验证、Critic 全部未改；运行时默认关闭。
- **收益判断**：该固定合成夹具上 recall@5 从 `2/8=0.25` 提升到 `8/8=1.0`，但这只是 instrument check，不是真实线上召回估计。任务要求「先构建确定性离线评测」且「如无明确收益不启用」；本轮只交付评测与结论，**不接 `DocumentSearchTool` 运行时、不加配置开关**，避免把合成收益误当成生产启用依据。

## 6. 已实现功能及提交

**Commit 1 `09f7c213`** — `feat(agent): 落地普通聊天工具步骤状态与结构化审计`（27 文件，+1584/-52）。A1 + A2 全部代码、测试、V28 迁移、CI/文档同步已入库；留在当前分支，未 push、未合并、未部署。

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
12. 自查发现 `ToolAuditService.record()` 的 DB 异常可能经拦截器打断聊天；加 try/catch，只记录 `errorType`，新增 `persistenceFailureNeverPropagatesIntoTheChatStream`，amend commit 1 为 `09f7c213`。
13. V28 `UNIQUE(toolCallId, toolStatus)` 全局作用域过宽；发现时 V28 已提交/应用，按规则**不修改已应用迁移**，留作可由 V29+ 追加解决的残余风险。
14. B1 POC 首轮 `budgetFencingCancellationAndDeadlineBlockTheExtraAttempt` 失败：测试脚本第二次响应写成了合法 JSON，导致重试成功而非抛出目标异常。这是夹具错误，不是放宽断言；改成第二次仍格式错误 / 用 `now` 与取消状态精确驱动护栏后 9/9 通过。

## 8. 仍未完成

commit 2（B1 POC + B2）与 commit 3（C1/C2）、改树后的完整回归（`scripts/verify.sh` / GraphExecutionTest / CollaborationRunTest / 引用与权限安全测试 / 前端 lint+build / 契约 / hosted CI）、最终独立审查、`docs/plans/2026-11-14-deepresearch-implementation-final.md`、更新借鉴评估实施状态、标记需要新的最终合并审查。A2 残余：`ToolAuditService.listOwned` / `summarizeOwned` 尚无 REST 端点，服务与 owner-scoped mapper 已可用。C2 运行时扩展按「合成评测不等于生产收益」保持不启用。

## 9. 下一轮可执行动作

1. 读本文件 + `git status` / `git log`；commit 1 已在 `09f7c213`，B1/B2/C1/C2 改动尚未提交。
2. 提交 commit 2：B1 隔离 POC + B2 来源分层 + 进度文件；提交 commit 3：C1 导出规范 + C2 离线评测 + 进度文件。
3. 按第六节跑全量回归：后端 `scripts/verify.sh`、GraphExecutionTest / CollaborationRunTest / 引用与权限安全测试、`web` 四门禁、16 事件 / 默认关闭 / SSE / R5 基线；查看 hosted CI。
4. 写最终报告、更新借鉴评估、显式标记「需要新的最终合并审查」，然后停止循环。

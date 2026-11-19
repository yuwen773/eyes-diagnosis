# Codex NO_GO 定向整改台账（2 P0 + 5 P1）

> 输入：Codex 独立审查 `D:\Work\code\iris-codex-audit-7dc3422b\docs\release\codex-independent-review.md`，
> 裁决 **NO_GO**，审查对象候选 `7dc3422b70828d400ad1d3a09e8c29aa12f48309`（代码 SHA `6ff5a889`）。
>
> 本文件只记录**整改事实**（根因 / 改动 / 提交 / 回归证据），不改写、不覆盖 Codex 的原始结论；
> 是否解除 NO_GO 由 Codex 复验决定。Codex 的审查工作树全程只读。

## 0. 状态总表

| 编号 | 结论 | 整改提交 | 回归用例（真实路径） | 状态 |
|---|---|---|---|---|
| P0-01 视觉工具把无效上游输出登记为成功 | 已修 | `0e75c9f3` | `EyeImageAnalyzerToolOutputValidationTest`（13）、`AgentEyeImageInvalidOutputEndToEndTest`（2，真实 `@Tool` + 真实 `ReactAgent`） | 待复验 |
| P0-02 备份失败后清理脚本仍继续强制删除 | 已修 | `29cffaac` | `scripts/tests/worktree-hygiene-failclosed.sh`（10 例 / 28 断言，PATH 注入假 git/tar） | 待复验 |
| P1-01 超时/取消与真实回放状态不一致 | 已修 | `45078650` | `ToolFailureCategoryTest`（7）、前端 `agentSteps` / `ThoughtLine` / `agentStream` 用例 | 待复验 |
| P1-02 分批向量写入失败后仍有半份文档成为来源 | 已修 | `2b21617c` | `DocumentProcessingServiceChunkRollbackTest`（2）、`DocumentSearchToolReadyOnlyTest`（4） | 待复验 |
| P1-03 用户文本被历史解析器误认为受信影像附件 | 已修 | `90a568b7` | `ChatHistoryServiceUserMessageTest`（5）、`agentStream.test.ts`（34）、`agentResources.test.ts`、`UserMessage.test.tsx`（3） | 待复验 |
| P1-04 V17 升级后的回滚指引与迁移路径冲突 | 已修（文档 + 实测用例） | `33bdf2a7` | `FlywayMySqlIntegrationTest` 新增 2 例，本机 MySQL 8 隔离 schema 5/5 绿 | 待复验 |
| P1-05 模型预算耗尽以正常结束掩盖未生成回答 | 已修 | `c3a56ae9` | `AgentBudgetExhaustionTest`（3，真实 `ReactAgent` 图） | 待复验 |

> **第二轮复验结果（2026-11-19）**：P0-01 **CLOSED**；其余 6 条第一轮修法未覆盖全部路径，
> 判 **STILL_OPEN**，本轮按审查方给出的最小任务重新整改，逐条改法与证据见 §9。
> 本表 §1–§7 保留第一轮记录不改写，只作历史。

## 1. P0-01 · 视觉工具把无效上游输出登记为成功

- **根因**：`EyeImageAnalyzerTool` 用宽松解析把视觉模型返回的任何文本都拼成 `EyeAnalysisResult`
  （空 JSON、拒绝提示都能过），失败因此以「成功」进入 SSE、历史与审计。
- **改动**：新增 `InvalidToolOutputException`；严格解析（只接受完整 JSON 对象，必填字段、
  枚举 `urgency`、拒绝尾随内容）；业务异常与无效输出一律抛出而不是吞成结果。
  同一失败在四处出口一致：SSE 终态 `failed`、历史 `status/errorCategory`、审计 `FAILED/INVALID_OUTPUT`、
  交给模型的是错误响应而不是分析对象。
- **回归**：13 条解析边界用例 + 2 条端到端（真实 `@Tool` 经框架执行）；对照组（合法 JSON 仍成功）同测。
- **真实链路旁证**（G3-3）：在真实 DashScope 下让模型调用 `analyzeEyeImage` 并传入不存在的 imageId，
  终态为 `failed` / `TOOL_EXCEPTION`，且 **SSE 帧、会话历史、`t_agent_tool_audit`、交给模型的错误响应
  四个出口一致**；模型拿到的是错误文本，没有编造任何影像分析结论。见 `verification-matrix.md` §2.7。

## 2. P0-02 · 备份失败后清理脚本仍继续强制删除

- **根因**：`scripts/worktree-hygiene.sh` 的归档动作没有 fail-closed：备份命令失败后仍走到
  `git worktree remove --force`。另外复查时发现更严重的一条——脏树在**有独有提交**时
  会被先归类成可归档，`--archive-dirty` 单独就能删除独有提交。
- **改动**：归档改为「暂存目录 → 全部校验（patch / untracked tar 对账 / `git bundle verify` /
  HEAD 与 status 复核）→ 原子 `mv` 发布 → 发布后复验」，任一步失败即中止且返回非零；
  归类新增 `ARCHIVE:dirty+unique`，删除独有提交必须同时给 `--archive-dirty` 与 `--drop-unique`。
- **回归**：`scripts/tests/worktree-hygiene-failclosed.sh` 用临时仓库 + PATH 假 `git`/`tar`
  注入失败，10 例 28 断言；包含「bundle 失败不得删除」「独有提交必须双开关」两个反向用例。

## 3. P1-01 · 超时、取消和真实回放状态不一致

- **根因**：框架在拦截器 catch 之前就把异常转成 `ToolCallResponse.error`，类别信息丢失，
  于是超时/取消/无效输出全部塌缩成 `TOOL_EXCEPTION`；终态落库还挂在 SSE 订阅者上，
  浏览器断连或用户停止后终态不落库，刷新后回放与实时不一致。
- **改动**：`ToolStepContract` 增加 `[TOOL_ERROR:CATEGORY]` 标记与 `categoryFromText/stripErrorTag`；
  拦截器从错误响应文本恢复类别并剥离标记（标记不泄漏给模型）；MCP 回调对超时/过载打标记；
  `ToolStepSink` 在状态转移处直接落库终态，不再依赖订阅者；历史载荷带 `errorCategory`，
  前端 `stateFromToolResult` 据此区分 `timeout`/`cancelled`/`error`，`ThoughtLine` 对
  `INVALID_OUTPUT` 给出「不能当作医学证据」的措辞。
- **回归**：`ToolFailureCategoryTest` 7 例（含「订阅者被 dispose 后终态仍落库」「迟到结果不得覆盖已取消步骤」）；
  新增前端 8 条断言（`agentSteps`/`ThoughtLine`/`agentStream`）。
- **真实链路旁证**（G3-4）：真实 DashScope 会话中客户端 6 秒后断开 SSE（已收 25 帧、无 `done`），
  12 秒后查历史，两个并行 `searchDocuments` 仍都带终态 `status=succeeded` —— 终态落库不依赖 SSE 订阅者。
  审计表同时留下 `running` 与终态两行（`succeeded` / `failed` + `errorCategory`）。

## 4. P1-02 · 分批向量写入失败后，半份文档仍成为 RAG 来源

- **根因**：`EmbeddingBatchWriter` 按 10 条分批写 Chroma，第二批失败时只把 MySQL 标成失败，
  第一批向量留在库里；检索侧不看文档状态，残留片段照常作为来源交给模型。清理还依赖
  失败文档中缺失的 `chunkCount`。
- **改动**：写入失败即按 `documentId` 元数据清理已写批次并重试一次，随后标记失败；
  检索侧新增 `readyOnly`：只保留文档状态为就绪的片段（无 `documentId` 的旧语料不判死，
  状态查询失败时 fail-closed 少引用）；`KnowledgeBaseServiceImpl` 的删除同样按
  `chunkCount` 或 `documentId` 过滤式清理，不再依赖单一字段。
- **回归**：`DocumentProcessingServiceChunkRollbackTest`（注入 11 片段、第 2 批失败 → 清理 + 状态 2 + 不写 chunkCount；
  正常路径不清理）与 `DocumentSearchToolReadyOnlyTest`（失败文档片段、无 documentId 旧数据、
  查询异常、字符串 documentId 四种）。

## 5. P1-03 · 用户文本可被历史解析器误认为受信影像附件

- **根因**：落库信封只有 `text` + `images`，历史解析器凭形状即可认定「这是上传附件」；
  用户自己打出的同形 JSON（或模型文本）会被改写成正文并渲染外链图片。
- **改动**：服务端信封加 `kind=iris.user-message.v1`（该标记即 `AgentController#assertOwnedImages`
  归属校验的凭证）；`parseUserEnvelope` 只认带标记的信封，无标记的旧信封按纯文本保守显示，
  不补造附件；新增 `isTrustedAttachmentUrl` 只放行上传命名空间（`https://<cosHost>/agent-chat/…`）
  与站内相对路径，`UserMessage` 渲染前再过滤一次；跨语言契约由两侧字面量测试各钉一次。
- **回归**：新增「用户打出的同形 JSON 逐字保留、不产生附件」「旧信封不补造」「带标记但外链被丢弃」
  三条断言（旧实现下先红后绿）；正对照为真实上传命名空间地址；`UserMessage` 渲染层 3 例。
- **真实链路旁证**（G3-5）：在真实 DashScope 会话里发送与受信信封同形的 JSON
  （含 `kind`/`text`/`images`），历史里**逐字保留为纯文本**、`images=null`，未合成任何附件；
  模型也未把其中的外链当成自己的图片。
- **已知取舍（第二轮后已补齐）**：修复前写入的老行没有服务端标记。第二轮审查要求
  「保留原文并支持经归属复核后的附件恢复」，本轮已实现：旧行正文**按原文返回**（不改写、不剥离），
  其中的图片引用逐张交回 `authorizedViewUrl` 做**当前用户归属复核**，复核通过才恢复成附件；
  未登记 / 跨用户 / 已删除的引用一律不恢复。伪造正文因此最多只能引用**自己确实拥有的**上传，
  且正文仍显示为原文 JSON，不会被改写成「附件消息」。测试：
  `AgentAttachmentTrustTest#legacyRowKeepsRawTextAndRestoresOnlyOwnedUploads`、
  `#legacyPlainTextRowStaysPlainTextWithoutTouchingUploads`。

## 6. P1-04 · V17 升级后的回滚指引与迁移路径冲突

- **根因**：手册把「相对 ui 零新增迁移」外推到所有目标库，只写「恢复旧 jar 直接起服务」，
  既没说明 master V17 的库升级会真的执行 V18–V28，也没给可验证的回退路径。
- **实测（先跑再用结论写文档）**：master V17 → V28 之后，旧 jar（classpath 只到 V17）**可以**启动——
  V18–V28 对其为 `FUTURE_SUCCESS`，Flyway 默认 `ignoreMigrationPatterns=*:future` 放行；
  对既有表的影响只有 V22 给 `t_diagnosis` 加一列可空 `patientTaskId`，旧形状 INSERT 仍成功。
  反之，history 含本 jar 解析不了的版本（旧 release 线 V10–V14 的形状）时 Flyway 判 missing 拒绝启动。
  **注意**：这一点与审查报告「恢复旧 jar 后无法启动」的推断不同，本台账按实测记录。
- **改动**：`upgrade-rollback-manual.md` 新增 §2 按 `flyway_schema_history` 判定路径（A 已 V28 /
  B master V17 / C 旧 Java 线 / 中途库 / 校验和不一致），§4 重写为逐路径回滚
  （B-1 代码回滚、B-2 恢复备份到新库 + 数据差异核对 + 切流，C 只重建，均要求先在副本演练）；
  `migration-matrix.md` 增 §2.1 回滚方向表；`release-notes-rc.md` §5 改为逐历史表述。
- **回归**：`FlywayMySqlIntegrationTest` 新增
  `#anOldMasterJarStillStartsAfterTheDatabaseWasUpgradedToV28`、
  `#aJarRejectsAHistoryThatContainsVersionsItDoesNotResolve`；本机 MySQL 8.0.26 隔离 schema 5/5 绿。

## 7. P1-05 · 模型预算耗尽时以正常结束掩盖未生成回答

- **根因**：框架用正常完成信号结束图，无论真答完还是撞上限；`DiagnosisAgent` 因此把被截断的回合
  渲染成「工具都成功、然后什么都没有」，Controller 照常追加 `done`。
- **改动**：`CountingChatModel` 统计本轮模型调用，`ToolCallBudgetInterceptor` 暴露被拒次数；
  回合结束时若没有任何助手正文，按原因（工具预算 / 模型预算 / 其他）生成**明确终止说明**，
  以 ASSISTANT 帧发出并落库，可回放；不增加任何上游调用。
- **回归**：`AgentBudgetExhaustionTest` 3 例（工具预算耗尽、模型预算耗尽、正常回答不被说明替换），
  全部走真实 `ReactAgent` 图与真实拦截器。

## 8. 尚未解除的边界（不作通过声明）

- **G-3 真实 DashScope**：已于 2026-11-19 用真实凭据执行（5 个场景：流式问答 / 真工具成功且真 RAG 命中 /
  真工具失败且四出口一致 / SSE 断流后终态仍落库 / 用户文本伪装信封不被当作附件），
  证据见 `verification-matrix.md` §2.7。**但原始链路证据（SSE 帧、历史行、审计行、提供方调用记录）
  在验证后即删除，第二轮独立审查只能读到自述与汇总表，无法交叉核验**——按「不同 SHA / 不可核验的
  证据不能顶替」的口径，G-3 的工程链路结论只作自述记录，**不作为已通过的外部集成证据**；
  视觉工具成功路径与真实对象存储上传仍未验证（占位 COS 凭据 → 无法上传真实影像，
  `qwen-vl-plus` 从未被真实调用）。外部集成通过**不等于**真实临床能力通过。
- **G-5 双主题响应式截图**：仍 OPEN。旧 72 张截图属于首轮 `7dc3422b` 的 Vite 验收，缺少可独立确认的
  构建内容指纹，不能整体升级为新 SHA 证据；断言式门禁（对比度 / 版式）已跑，但不等于截图证据。
- 医疗默认值与冻结基线未改动：协作默认关闭、医生复核写入保持关闭、冻结 tag 未移动。

## 9. 第二轮独立复验（2026-11-19）

第二轮审查报告：`D:\Work\code\iris-codex-audit-round2\codex-independent-review-round2.md`，
审查对象 `03b14efd`（代码）/ `dfca3801`（文档），结论 **NO_GO**：P0-01 CLOSED，
其余 6 条 **STILL_OPEN**。第二轮的缺口不是「没修」，而是首轮修法没覆盖到的路径。

| 编号 | 第二轮指出的缺口 | 本轮改法 | 回归证据 |
|---|---|---|---|
| P0-02 | 状态查询失败、未跟踪文件枚举失败、归档期间文件再被修改、bundle 包截断，四种情况仍能进入删除 | 归档改为「可证实才算成功」：所有 git 查询结果显式判定、在空仓库真实导入 bundle 并核对固定 HEAD、按原始字节比对内容清单、删除前再比对当前 HEAD 与快照 | `scripts/tests/worktree-hygiene-failclosed.sh`（87 断言 / 12 例，含四种负例） |
| P1-01 | 线程中断仍被记成 TIMEOUT、Future 未取消；终态在历史提交前就发出；前端实时映射丢 `errorCategory` | `MCPManager` 中断→`cancel(true)` + 重设中断标志 + `CancellationException`；`ToolStepSink` **先提交后发送**，提交失败不发终态帧而发流错误；`SessionMessageQueue` 提供可等待、可恢复的按会话串行写；实时 DTO 补 `errorCategory` | `ToolTerminalCommitTest`、`McpTerminalCategoryTest`、`ToolFailureCategoryTest`、`ToolTerminalPersistenceMySqlIntegrationTest`（真实 MySQL 注入写失败 → 断流 → 重读恢复 → 迟到结果不覆盖）、`agentStream.terminal.test.ts`、`ThoughtLine.terminal-wire.test.tsx`（TIMEOUT / CANCELLED / INVALID_OUTPUT 实时与回放同渲染） |
| P1-02 | 清理失败后，较短成功重试会重新接纳上一代残留片段 | 每次处理生成服务端 `indexVersion`：`beginIndex`/`finishIndex` 带版本 CAS，片段与资源带版本，检索只认「READY + 当前版本」，历史资源引用按当前用户 + 版本复核 | `DocumentProcessingServiceChunkRollbackTest`、`DocumentSearchToolReadyOnlyTest`、`DocumentSearchToolOwnershipTest`、`FlywayMySqlIntegrationTest`（V29）、探测器 `scripts/tests/IrisRagGenerationProbe.java` |
| P1-03 | 公开 `kind` 仍是可伪造的信任凭证；任意第三方同形地址仍获前端放行 | 附件身份移入客户端不可写的 `subType` 列；历史读取逐张按**当前用户**复核上传归属；上传接口只返回 `/api/agent/image/view/<file>`，取图端点服务端复核后 302；前端只认该受保护路径；旧行保留原文并支持**经归属复核**的附件恢复 | `AgentAttachmentTrustTest`（5）、`ChatHistoryServiceUserMessageTest`、`DiagnosisAgentImageReferenceTest`、`agentAttachmentTrust.test.ts`、`agentResources.test.ts`、`UserMessage.test.tsx` |
| P1-04 | 旧 JAR 虽能启动，但会恢复正式复核写入与推理输出；手册未要求安全产物；恢复库差异核对有缺口 | 手册改成四项分别验收并写明「旧产物禁止切流」；回滚只能恢复到新库，按**停写源库**逐表对账新增/更新/删除（含 V18–V29 数据）；测试名改为只声明迁移解析兼容 | `docs/release/upgrade-rollback-manual.md` §1/§2/§4；`#oldMigrationSetAcceptsFutureVersionsWithoutCertifyingArtifactSafety`；探测器 `scripts/tests/IrisRollbackDataProbe.java` |
| P1-05 | 同一模型节点先铺垫文字再请求工具，预算截断后仍无终止说明 | `CountingChatModel` 记录**最后一次**模型调用是否仍要求工具；截至预算耗尽仍要求工具时，追加并持久化终止说明（`finishReason=TOOL_BUDGET_EXHAUSTED / MODEL_BUDGET_EXHAUSTED`），保留既有铺垫 | `AgentBudgetExhaustionTest`（新增「铺垫后请求工具」场景）、`ToolTerminalPersistenceMySqlIntegrationTest#verifyBudgetTurn` |

P0-01 未回退：视觉工具无效输出仍走 `INVALID_OUTPUT` 失败路径，四出口一致。


## 10. 第三轮独立交叉复审（2026-11-19，结论 CONDITIONAL）

复审由独立子代理执行，审查对象为本轮整改后的代码树。结论 **CONDITIONAL**：
既不是 `INDEPENDENT_PASS`，也不是 `NO_GO`。**关键在于两条高危缺陷都落在本轮整改自己引入的代码上**——
第二轮的整改把「终态一定落库」这条保证打穿了。

| 编号 | 级别 | 复审结论 | 本轮改法 | 回归证据 |
|---|---|---|---|---|
| D1 | 高 | 队列顺序遍历、遇错即中断；失败的键只在成功后才移除；`pendingWrites` 无淘汰无 TTL；`recoverPending` 抛错 → **一个永久失败的写会永久毒死该会话**（新消息永不落库），且整段历史 500 | ① 等待有界：默认 15s（`agent.queue.await-timeout-ms` 可配），超时后写任务继续在后台跑完（写入按雪花 id 幂等），调用方拿明确错误；② 逐键隔离：失败的键累计 3 次后淘汰并记账，后面的写照常进行；③ 待写集合按会话限额（256）+ 存活时长（30 分钟）淘汰；④ `recoverPending` 不抛错，降级为 `uncommittedTerminal` 标记（历史照常返回，但明说不完整） | `SessionMessageQueueTest`（+4：毒化不阻塞后续 / 挂起有界 / 待写有上限 / 恢复失败不抛）；`ToolTerminalPersistenceMySqlIntegrationTest#verifyPoisonedSessionSurvives`（真实 MySQL 触发器注入永久写失败 → 后续消息照常落库 + 未提交被标记） |
| D2 | 高 | `await` 无超时 + `ToolStepSink` 在 `synchronized` 方法内调 `persist` 跨库提交持锁 + 所有落库都 `await` → **数据库挂起 = 全服务挂起** | `ToolStepSink` 状态监视器只保护极短临界区；**落库移到锁外**，下发单独由 `emissionLock` 保序（先落库、再下发、不排在 complete 之后）；落库失败转成流错误；`deliveryCancelled`（传输取消）与 `fluxTerminated`（流已结束）拆成两个开关，不再一词两义 | `ToolStepConcurrencyTest`（既有 5 条全绿，语义未放宽）；`SessionMessageQueueTest#aHangingWriteDoesNotBlockTheCallerForever` |
| D3 | 中 | 旧行的用户正文按原始 JSON 显示——「他说的话」被藏起来 | 旧附件信封的正文按 `text` 还原；**但正文形状不是凭证**：只有这一行确实带着当前用户拥有的一张上传（逐张归属复核通过）才还原，否则整段按普通文本原样显示 | `AgentAttachmentTrustTest#legacyRowRestoresReadableBodyOnlyWhenAnOwnedUploadProvesItWasAnEnvelope`、`#legacyRowWithoutOwnedUploadStaysRawAndGrantsNothing`；前端 `agentStream.test.ts`「旧行正文原样可读」 |
| D4 | 中 | 历史工具结果里失效来源被处理成「把模型原文覆盖成『来源已失效』」→ **证据链被抹掉** | 只淘汰失效来源，**保留模型当时的原文**，失效情况用 `sourcesExpired` 标记 | `AgentAttachmentTrustTest#staleToolSourcesAreDroppedButTheOriginalOutputSurvives` |
| 低 | 低 | 取消不再打断排队中的写；队列自死锁风险；`USER_MESSAGE_ENVELOPE_KIND` 导出与注释过期；`deliveryCancelled` 一词两义 | 取消语义与自死锁风险**如实登记**（见下「本轮未改的已知边界」），不假装已修；过期导出与注释删除（前端不再拆信封，改由服务端还原，前端只按服务端给的正文与已复核图片渲染）；两义拆成两个开关 | `agentStream.test.ts`（删除过期常量用例，补「旧行正文原样可读」）；前端 `typecheck` / `lint` 通过 |
| 用例有效性 | — | `DocumentSearchToolReadyOnlyTest` 只测私有过滤方法；P1-02 核心场景只在手工探测器里；前端断言丢掉了「旧正文可读」 | 新增**走真实检索路径**的回归：向量库返回旧代与当代片段 → `searchDocuments` → 模型实际看到的文本 | `DocumentSearchToolStaleGenerationTest`（2） |

### 10.1 本轮未改、但必须写清的已知边界

| 边界 | 说明 | 为什么不在本轮改 |
|---|---|---|
| D5 存量知识文档没有重处理入口 | `indexVersion` 准入只对**重新处理过**的文档生效。存量文档仍是旧代，当前**没有全量重处理入口**。检索侧因此 fail-closed（宁可不引用，不引用旧代），但「存量文档重新纳入证据」需要一次全量重处理——这是运营动作，不是代码缺陷 | 需要产品决定重处理范围与语料成本；改代码补入口而没人执行，等于多一条没人走的路 |
| D6 用户消息写入失败会 500 | 写用户消息是 fail-closed：落库失败就返回错误，**不假装已受理**。代价是数据库抖动时用户看到请求失败需要重发；换来的是不会出现「助手回了、用户那句没存」的错位 | 这是与 P1-01「终态不先发」一致的方向，改成「先返回成功、事后补写」等于把丢消息的风险转给用户 |
| 取消不再打断排队中的写 | 取消只停流，已入队的写仍会提交（按会话串行）。这是「终态不丢」与「立刻停止」之间的取舍：停下写入会让已发生的工具调用在历史里缺终态 | 改它要重做「取消语义」，属于独立议题；本轮只登记 |
| 队列自死锁风险 | 队列的 `synchronized` 临界区里会调用 `submit`，而执行体又要拿同一把锁——当前实现里临界区不等待执行体（等待发生在临界区之外），因此**现在没有自死锁**；但这个形状对后续改动很敏感 | 当前无缺陷可修；已在代码里用「等待在临界区之外」的写法固定住这一边界 |

### 10.2 结论

第三轮复审的 `CONDITIONAL` 结论**未被本轮整改推翻，也未被本轮整改解除**：
两条高危缺陷已逐条整改并有走真实执行路径的回归，但**整改本身尚未经独立复审再次确认**。
本候选的诚实状态是 **`SELF_VERIFIED / PENDING_INDEPENDENT_RE-REVIEW`**，不是 `MERGE_READY`。

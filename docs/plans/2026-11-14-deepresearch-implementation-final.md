# DeepResearch 工程能力借鉴 · TASK-11 最终报告

日期：2026-11-14 · 工作树 `realtime-product-acceptance` · 分支 `codex/realtime-product-acceptance`
基线：`7c028b80d3c77d4e955856cc2740998aea4ecc4c`（PR #68 原审查 head）
最终代码 HEAD：`20b620ccdc3d5c903726ef891a2f8f335e51e0d7`
最终文档 HEAD：当前分支 tip（docs-only 提交；避免报告内嵌自身 SHA 过期）
终态：**`IMPLEMENTATION_COMPLETE`**（可安全实施的工作包完成，必需工程门禁全绿；默认关闭 / 暂缓项有证据，不伪称生产可用）

> **合并边界**：新增功能改变 PR #68 原已审查代码树，`docs/plans/2026-11-13-pr68-final-merge-review.md` 的 `MERGE_READY` 结论不可沿用；**需要新的最终合并审查**。本任务未合并 PR #68、未切 master、未部署、未启用医疗协作生产功能、未调用真实模型、未使用真实患者数据、未重启 R5。

## 1. 逐项交付

| BORROW 项 | 标签 | 提交 SHA | 代码 / 文档文件 | 实测数据 | 残余风险 |
| --- | --- | --- | --- | --- | --- |
| A1 工具执行步骤语义与完成态 | `IMPLEMENTED` | `09f7c213` | `src/main/java/com/csust/eyediagnosis/agent/ToolStepContract.java`、`ToolStepSink.java`、`ToolExecutionInterceptor.java`、`DiagnosisAgent.java`、`model/dto/agent/MessageDTO.java`；`web/src/lib/agentStream.ts` + 两个测试；`web/src/components/agent/messages/ToolRequestMessage.tsx`、`web/src/styles/agent.css` | `ToolStepContractTest` 8/0、`DiagnosisAgentRedactionTest` 4/0、`agentStream` 17/0；Vitest 356；生产构建 `collaboration-default-off.spec.ts` 1/1；协作明暗 / 移动端 12/12 | 旧历史消息没有 `toolCallId`，不显示完成态；这是保守兼容，不推断成功。 |
| A2 工具调用结构化审计 | `IMPLEMENTED_DEFAULT_OFF` | `09f7c213` | `agent/service/ToolAuditService.java`、`mapper/AgentToolAuditMapper.java`、`model/entity/AgentToolAudit.java`、`db/migration/V28__agent_tool_audit.sql`、`ToolAuditServiceTest.java`、`ToolAuditMySqlIntegrationTest.java`；`application.yml`、`CLAUDE.md`、`docs/architecture/migration-matrix.md`、CI/verify 同步点 | `ToolAuditServiceTest` 9/0；真实 MySQL 8 `ToolAuditMySqlIntegrationTest` 1/0、`FlywayMySqlIntegrationTest` 3/0、`UploadTaskMapperMySqlIntegrationTest` 3/0；V28 列断言无 `arguments/args/prompt/content/patientid`；跨用户负例通过 | 持久化默认关闭，启用需 V28 表 + `AGENT_TOOL_AUDIT_DIGEST_KEY`；无 REST 查询端点；V28 `UNIQUE(toolCallId,toolStatus)` 全局作用域过宽，需 V29+ 收紧（不改已应用迁移）。 |
| B1 结构化输出解析失败有限重试 | `POC_ONLY` | `4654293a` | `src/test/java/com/csust/eyediagnosis/poc/realtime/FormatOnlyRetryPoc.java`、`FormatOnlyRetryPocTest.java` | 9/9 确定性故障注入测试：默认关闭、最多额外 1 次、仅 `JsonProcessingException`、provider/timeout/safety/insufficient-citation/schema/response-shape/Critic 不重试、预算 / fencing / 取消 / 总时长、CHARGED 未提交恢复不重复调用、COMMITTED 幂等重放 | 运行时缺 durable per-attempt 幂等键；未接 `DraftAgents` / `PatientDraftCoordinator`，未改 Critic / 引用 / 证据门禁。启用需 V29+ 台账并独立验证恢复语义。 |
| B2 来源类型元数据分层 | `IMPLEMENTED_DEFAULT_OFF` | `4654293a` | `agent/rag/SourceTypePolicy.java`、`agent/tools/DocumentSearchTool.java`、`service/impl/DocumentProcessingService.java`、`agent/rag/BuiltinCorpusSeeder.java`、`application.yml`；`SourceTypePolicyTest.java`、`DocumentSearchToolOwnershipTest.java`、`BuiltinCorpusSeederTest.java` | 6+5+6 测试全绿；owner OR 过滤后只 filter 不 add；BM25 / RRF 混合路径不能绕过；UNKNOWN / `AUTHORIZED_EXTERNAL` fail-closed；R5 基线 `VERIFIED`；受控引用 / 患者授权 / 协作路径 0 diff | 默认关闭；存量 Chroma 只做运行时保守推断，无 SQL 回填；`AUTHORIZED_EXTERNAL` 不授予；准入谓词若扩展需 ADR + 独立验证；可选 `src/README.md` 说明未补。 |
| C1 会话导出规范 | `IMPLEMENTED` | `3c81b9af` | `agent/service/ChatHistoryService.java`、`ChatHistoryServiceOwnershipTest.java`；`web/src/lib/sessionExport.ts` + 7 条测试、`web/src/pages/AgentPage.tsx` | 后端 owner + `format` 白名单 3/0；前端 7/0；Vitest 356；typecheck / lint / build 均通过 | 保持 `BaseResponse<String>`，无 `Content-Disposition` / PDF / 新附件端点；下载错误经既有 `useFault` 呈现。 |
| C2 白名单式多查询扩展 | `IMPLEMENTED_DEFAULT_OFF`（离线评测） | `3c81b9af`、`20b620cc` | `scripts/evaluate_rag_query_expansion.py`、`scripts/tests/test_evaluate_rag_query_expansion.py`、`evaluation/rag-query-expansion/corpus.json`、`docs/plans/2026-11-14-rag-query-expansion-eval.md`、`.github/workflows/verify.yml`、`.gitignore` | CLI 单测 5/5；固定 10 例 recall@5 `2/8=0.25 → 8/8=1.0`（+6）；OOD/QUALITY 零 provider 调用、跨用户隔离、延迟上限、扩展上限全 true；hosted CI `issue24-evaluation` 生成 artifact | 合成语料收益不是线上效果估计；运行时多查询扩展未接 `DocumentSearchTool`，无生产开关；不得据此降低引用门禁或启用真实模型外呼。 |

未实施但明确有界：6 个 `CONSIDER` 项与 15 个 `SKIP` 项维持原评估结论，未以 PoC / ADR 冒充生产实现。`docs/plans/2026-11-13-deepresearch-borrowing-review.md` 已补 §0 实施状态；本文件为权威终态。

## 2. 完整回归证据

### Hosted CI（最新）

- Run `43476909612`，代码 HEAD `20b620ccdc3d5c903726ef891a2f8f335e51e0d7`，`completed / success`，**20/20 jobs success**，0 个非 success job。
- Run `43481159702`，前一次文档 amend `c8c61894448ef77dac335c9cb033e11c18e09cc7`，`completed / success`，**20/20 jobs success**。
- Run `43482041616`，当前 docs-only tip 的最终 push，`completed / success`，**20/20 jobs success**，0 个非 success job；这是当前分支最新 hosted CI。本报告不内嵌自身提交 SHA，避免 docs amend 造成自引用过期。
- 覆盖 `backend-compile / backend-unit / flyway-mysql` 双向顺序 / `graph-execution-mysql / collaboration-mysql / issue17–24-mysql / web / frontend / docs-contract / issue24-evaluation / python / watchdog / product-contract`。
- 旧 run `43441896212` 只对应基线 `7c028b80`，不能替代新树。CI 日志扫描未发现真实密钥、真实患者标识或私钥。

### 本地全量与专项

| 类别 | 命令 / 套件 | 结果 |
| --- | --- | --- |
| 全量后端 | `scripts/verify.sh -q -B` | `==> verify green`；一次性 MySQL 8 + Redis；Flyway V1–V28，current v28 |
| Surefire 汇总 | full verify | 73 suites / 564 tests / 0 failures / 0 errors / 297 skipped（环境门控 opt-in；pass 2 与专项运行覆盖 DB suite） |
| Graph / 协作 | `GraphExecutionTest`、`CollaborationRunTest` | 32/0/0/0、32/0/0/0 |
| 引用与权限 | `ControlledReferenceApiTest`、`PatientDraftTest`、`PatientExplanationApiTest` | 13/0/0/0、41/0/0/0、37/0/0/0 |
| 迁移 | `FlywayMySqlIntegrationTest`、`UploadTaskMapperMySqlIntegrationTest`、`ToolAuditMySqlIntegrationTest` | 3/0、3/0、1/0 |
| 前端四门禁 | `typecheck`、`test`、`lint`、`build` | 通过、38 files / 356 tests、通过、成功（仅既有 >500 kB chunk 警告） |
| Playwright | `collaboration-default-off.spec.ts`；`collaboration.spec.ts` | 1/1；12/12（生产构建，本机 Chromium headless shell 1234；预览 :4173 已停） |
| 脚本契约 | `check_collaboration_fixture.py`、`check_steering_docs.py`、`test_check_*.py`、`test_evaluate_*.py` | 16 event types / 12 snapshot fields；V28 steering 一致；36/36 OK；17/17 OK |
| R5 封存 | `collect_product_acceptance.py --verify-baseline` | `VERIFIED / evidenceFiles 18 / experimentClosed true / head 65727431…` |

**Playwright 范围说明**：`smoke.spec.ts` 缺 `E2E_USER` / `E2E_PASSWORD` 且需真实后端 + MySQL + Redis + 算法服务，设计上会 skip；`collaboration-backend.spec.ts` / `collaboration-safety.spec.ts` 需显式启动 `CollaborationBrowserServer` 与专用临时库，属于另一套合成验收 harness，其 Java HTTP/MySQL 安全门禁已由 hosted CI 的 `collaboration-mysql` / `issue18–23-mysql` 覆盖；`product-real-provider-r5.spec.ts` 是 R5 一次性真实提供方实验，已封存且 `restartForbidden: true`，本轮严禁重启。没有以跳过、删除测试或放宽断言换取绿色。

## 3. 安全与独立审查

- 两个只读子代理分别审计后端 / 前端增量，最终均返回 `*_REVIEW_PASS`（`BACKEND_REVIEW_PASS` / `FRONTEND_REVIEW_PASS`），无高置信度、gate-blocking 缺陷。子代理报告是源码审计结论，不是测试通过证据；主会话独立复核 load-bearing 源码：`ToolExecutionInterceptor` 仅在 `handler.call()` 返回 / 抛异常后 `finished`；`ToolStepSink.closePending()` 只标 CANCELLED；`ToolAuditService.record()` 捕获 DB 异常且 owner 断言；`SourceTypePolicy.restrict()` 只从候选列表 filter；`DocumentSearchTool` 在 owner OR 过滤后调用；C1 `format` 白名单与中性文件名；C2 脚本无网络 / 模型 import；B1 POC 无 Spring bean 注解；`application.yml` 保持 `agent.tool-audit.enabled=false`、`eye-diagnosis.collaboration.*=false`、`eye-diagnosis.rag.source-type.enabled=false`。
- 针对后端审查提出的 SAA 链式语义观察，主会话另以 JDK 21 `javap` 反汇编本地 `spring-ai-alibaba-agent-framework-1.1.2.2.jar`：`Builder.interceptors(Interceptor...)` 对内部 `interceptors` 列表执行 `addAll`（追加而非替换），`DefaultBuilder.separateInterceptorsByType()` 按类型分流到 `toolInterceptors`，`ReactAgent.collectAndMergeToolInterceptors()` 把显式 `toolInterceptors` 全部加入链，再按名称合并 hooks 提供的工具拦截器，最后 `AgentToolNode.setToolInterceptors(...)`。本树 `DiagnosisAgent.buildAgent()` 未注册 hooks / 框架默认工具拦截器，新增 observer 不会覆盖既有 HITL 链；`InterruptionMetadata` / `TOOL_CONFIRM` 处理保持原样。该观察已关闭，不影响终态。
- `git diff 7c028b80..20b620cc`、4 条 commit message、hosted CI 日志扫描：命中项均为合成测试字符串（如 `张三` / `SECRET` 用于断言脱敏）、CI 一次性容器口令、既有配置占位符或构建文件名；无真实患者数据、真实 API key、私钥、凭据进入 Git 历史或日志。
- `src/main/java/.../collaboration`、`patientdraft`、`controlledreference`、`PatientAuthorization*` 与 `docs/testing/product-acceptance-r5` 均为空 diff；协作 16 事件契约、受控证据准入、引用验证、Critic、医生复核与患者保存授权未被放宽。`t_patient_authorization` 没有被当作外部文档授权凭证。
- 未引入 Langfuse / 云端 OTel / 公网搜索 / LLM 自由改写 / HyDE / 真实模型调用；V1–V27 未改；R5 未重启。

## 4. 失败与修复索引

累计 13 类失败 / 修复详见 `docs/plans/2026-11-14-deepresearch-implementation-progress.md` §5。代表性真缺陷：合并流终止等待、工具 pending 竞态、非法状态帧降级、DB 审计异常打断聊天、B1 测试夹具误把第二次脚本写成合法 JSON、B2 显式标记缺可信元数据佐证。Playwright 本机浏览器版本漂移通过显式 `E2E_CHROMIUM_EXECUTABLE_PATH` 与 `npm exec --` 参数转发解决，首次失败产物已清理。没有删除失败测试、伪造报告、放宽断言、关闭安全过滤器或跳过硬性 CI 检查。

## 5. 终态判定

判定 `IMPLEMENTATION_COMPLETE` 的依据：所有可安全实施的工作包均有真实代码与测试；B1 在技术条件不满足时按任务要求停在 `POC_ONLY`；B2 / C2 / A2 的关闭或暂缓项有配置与测试证据；后端全量、真实 MySQL 8 专项、前端四门禁、相关 Playwright、脚本 / 契约 / R5 封存验证及最新 hosted CI 全绿；敏感扫描与独立源码复核完成；最终报告、进度报告、借鉴评估实施状态均已更新。

判定不等于：代码已合并 master、PR #68 已获新放行、医疗协作可生产启用、B1 可上线、C2 有线上收益、A2 可直接开审计持久化或 R5 可重启。上述动作均需新的人类授权 / 独立审查 / 环境治理。

# TASK-11 · DeepResearch 工程能力借鉴落地进度（终态）

日期：2026-11-14 · 工作树 `realtime-product-acceptance` · 分支 `codex/realtime-product-acceptance`
基线 HEAD：`7c028b80d3c77d4e955856cc2740998aea4ecc4c`（PR #68 原审查 head；本任务**未合并**）
最终代码 HEAD：`20b620ccdc3d5c903726ef891a2f8f335e51e0d7`
最终文档 HEAD：当前分支 tip（docs-only 提交；用 `git rev-parse HEAD` 读取，避免报告自引用 SHA 过期）

## 0. 终态

`IMPLEMENTATION_COMPLETE`。A1、A2、B2、C1、C2 均形成可交付代码；B1 按任务预设的安全条件只交付隔离 PoC 与故障注入测试，未接入运行时。所有必需工程门禁通过，默认关闭 / 暂缓项均有证据，不伪称生产已启用。

**需要新的最终合并审查**：新增功能改变了 PR #68 原有已审查代码树，`docs/plans/2026-11-13-pr68-final-merge-review.md` 的 `MERGE_READY` 结论不可自动沿用。未合并 PR #68、未切 master、未部署、未启用医疗协作生产功能、未调用真实模型、未使用真实患者数据、未重启 R5。

## 1. 约束复核

- 未创建新 worktree、未删除两份已有未跟踪报告、未覆盖 R5 封存证据、未擅自清理其他 worktree。
- 新增 Flyway 仅 V28，V1–V27 未改。
- 普通聊天 SSE、协作 16 事件、默认关闭、R5 封存哈希保持兼容。
- 写入由主会话串行执行；只读子代理的结论均由主会话独立复核，不作为测试证据。
- 允许范围内：当前分支 4 个 commit，已 push 到 `origin/codex/realtime-product-acceptance`，无 force push。

## 2. 提交清单

| SHA | 标题 | 内容 |
| --- | --- | --- |
| `09f7c21347613899217bfb5cd0d543feea136af1` | `feat(agent): 落地普通聊天工具步骤状态与结构化审计` | A1 + A2；V28、服务/映射/实体、前后端状态流、测试、迁移矩阵与 CI 同步。 |
| `4654293adca8d250ccb8dbfef3dfb605cb24d2e5` | `feat(agent): 落地来源类型分层与格式重试隔离验证` | B1 隔离 PoC；B2 来源标记、默认关闭开关、保守回填与测试。 |
| `3c81b9afe3364d0e6ee419581079b6ade8b9edcd` | `feat(agent): 规范会话导出并新增确定性检索评测` | C1 导出规范；C2 离线评测、固定语料、CLI 单测、结果 gitignore。 |
| `20b620ccdc3d5c903726ef891a2f8f335e51e0d7` | `ci: 纳入确定性检索扩展离线评测` | hosted CI 增加 C2 CLI 验证与离线报告 artifact。 |
| docs-only tip | `docs(deepresearch): 记录 TASK-11 终态与最终验收报告` | 终态进度报告与最终报告；已 push。最后一次 hosted CI run `43482041616` 20/20 success。报告不内嵌自身 SHA，避免每次 amend 造成自引用过期。 |

## 3. 实测结果（最终代码树）

### Hosted CI

- Run `43482041616`（当前 docs-only tip，最终 push）：`completed / success`，20/20 jobs success，0 个非 success job。这是当前分支最新 hosted CI。
- Run `43481159702` / HEAD `c8c61894448ef77dac335c9cb033e11c18e09cc7`（前一次 amend）：`completed / success`，20/20 jobs success。
- Run `43480320923` / HEAD `2d29897f7442b1f5be82f2780cfa94e998dec9df`（文档 commit 的前一次 amend）：`completed / success`，同样 20/20 jobs success，0 个非 success job。
- Run `43476909612`（最终代码 commit）：`completed / success`，20/20 jobs success，0 个非 success job。两次 run 均覆盖 `backend-unit`、`flyway-mysql` 双向顺序、`graph-execution-mysql`、`collaboration-mysql`、`issue17–24-mysql`、`web`、`frontend`、`docs-contract`、`issue24-evaluation` 等门禁。
- 旧 run `43441896212` 对应 `7c028b80`，不能替代新树验证。
- CI 日志扫描未发现真实凭据、真实患者标识或私钥；命中项仅为构建产物文件名中的 `asterisk` 字符串。

### 后端与数据库

| 门禁 | 结果 |
| --- | --- |
| `scripts/verify.sh -q -B` | `==> verify green`；一次性 MySQL 8 + Redis，两遍；Flyway 到 V28、current v28 |
| 全量 verify 的 Surefire 汇总 | 73 suites / 564 tests / 0 failures / 0 errors / 297 skipped（环境门控 opt-in；pass 2 与专项运行覆盖 DB suite） |
| 新增关键单测 | `ToolStepContractTest` 8、`ToolAuditServiceTest` 9、`DiagnosisAgentRedactionTest` 4、`SourceTypePolicyTest` 6、`FormatOnlyRetryPocTest` 9、`ChatHistoryServiceOwnershipTest` 3、`DocumentSearchToolOwnershipTest` 5、`BuiltinCorpusSeederTest` 6 |
| 真实 MySQL 8 专项 | `ToolAuditMySqlIntegrationTest` 1/0、`FlywayMySqlIntegrationTest` 3/0、`UploadTaskMapperMySqlIntegrationTest` 3/0、`GraphExecutionTest` 32/0/0/0、`CollaborationRunTest` 32/0/0/0、`ControlledReferenceApiTest` 13/0/0/0、`PatientDraftTest` 41/0/0/0、`PatientExplanationApiTest` 37/0/0/0 |

### 前端与 Playwright

| 门禁 | 结果 |
| --- | --- |
| `npm --prefix web run typecheck` | 通过 |
| `npm --prefix web run test` | 38 files / 356 tests 通过 |
| `npm --prefix web run lint` | 通过 |
| `npm --prefix web run build` | 成功；仅既有 >500 kB chunk 警告 |
| 生产构建 `playwright test e2e/collaboration-default-off.spec.ts` | 1/1 通过；普通聊天 SSE、零协作 API 请求 |
| `VITE_COLLABORATION_ENABLED=true` 构建后 `playwright test e2e/collaboration.spec.ts` | 12/12 通过；明暗 / 移动端四张截图基线、终态、授权拒绝、键盘 / 对比度 / reduced-motion |
| Playwright 浏览器 | 本机 Chromium headless shell 1234（包期望 1254，显式 `E2E_CHROMIUM_EXECUTABLE_PATH`）；生产预览 :4173，结束后已停 |

未跑 / 不适用：`smoke.spec.ts` 缺 `E2E_USER` / `E2E_PASSWORD` 且需真实后端 + MySQL + Redis + 算法服务，按 `web/e2e/README.md` 设计会 skip；`collaboration-backend.spec.ts` / `collaboration-safety.spec.ts` 需显式启动 `CollaborationBrowserServer` 与临时库，属于另一次合成验收 harness，不等价于本轮代码门禁；`product-real-provider-r5.spec.ts` 属于 R5 一次性真实提供方实验，已封存、`restartForbidden: true`，严禁重启。相关 CI 的 Java HTTP/MySQL 安全门禁已经由 `collaboration-mysql` / `issue18–23-mysql` 覆盖。

### 脚本与契约

| 门禁 | 结果 |
| --- | --- |
| `check_collaboration_fixture.py --backend-root .` | `16 event types / 12 snapshot fields` |
| `check_steering_docs.py .` | V28 head 与 controller paths 一致 |
| `check_surefire_skips.py` 契约测试 | `36/36 OK` |
| `test_evaluate_*.py` | `17/17 OK`（含 C2 新增 5 条） |
| C2 CLI | recall@5 `2/8=0.25 → 8/8=1.0`（+6）；OOD/QUALITY 零 provider 调用、跨用户隔离、延迟上限、扩展上限全 true |
| `collect_product_acceptance.py --verify-baseline` | `VERIFIED / evidenceFiles 18 / experimentClosed true / head 65727431…` |
| 迁移 / 协作 / R5 路径 diff | `src/main/java/.../collaboration`、`patientdraft`、`controlledreference`、`PatientAuthorization*`、`docs/testing/product-acceptance-r5` 均无变更 |

## 4. 工作包交付与标签

| 项 | 标签 | 关键代码 / 文件 | 证据与边界 |
| --- | --- | --- | --- |
| A1 工具执行步骤语义与完成态 | `IMPLEMENTED` | `ToolStepContract.java`、`ToolStepSink.java`、`ToolExecutionInterceptor.java`、`DiagnosisAgent.java`、`MessageDTO.java`、`web/src/lib/agentStream.ts`、`ToolRequestMessage.tsx`、`web/src/styles/agent.css` | 状态仅由真实 `handler.call()` 结果产生；固定五态与白名单标签；`toolCallId` 精确归属；断流 / 错误 / 取消标 CANCELLED；旧 SSE 帧 `@JsonInclude(NON_NULL)`；`role="status"` + 文字配对 + 明暗 / 移动端。 |
| A2 结构化工具审计 | `IMPLEMENTED_DEFAULT_OFF` | `ToolAuditService.java`、`AgentToolAudit*.java`、`V28__agent_tool_audit.sql`、`DiagnosisAgent.redactedToolCall`、4 个新增测试 | 审计表含工具名、状态、用户 / 会话、起止时间、错误分类、HMAC 键名摘要；无原文列；持久化默认关闭；owner-scoped 查询；DB 失败不打断聊天；无 REST 端点。 |
| B1 严格格式重试 | `POC_ONLY` | `src/test/java/.../poc/realtime/FormatOnlyRetryPoc.java`、同名测试 | 仅 `JsonProcessingException` 触发最多 1 次额外尝试；预算 / fencing / 取消 / 总时长 / 崩溃恢复 / 幂等重放均有确定性测试；非 Spring bean、未接生产运行时、未改 Critic / 引用 / 证据门禁。 |
| B2 来源类型分层 | `IMPLEMENTED_DEFAULT_OFF` | `SourceTypePolicy.java`、`DocumentSearchTool.java`、`DocumentProcessingService.java`、`BuiltinCorpusSeeder.java`、`application.yml`、3 组测试 | 仅从既有 owner OR 过滤后的候选集中删除 UNKNOWN / `AUTHORIZED_EXTERNAL`；显式标记需可信元数据佐证；受控引用库与 `t_patient_authorization` 路径未动。 |
| C1 会话导出规范 | `IMPLEMENTED` | `ChatHistoryService.java`、`web/src/lib/sessionExport.ts`、`AgentPage.tsx`、后端 / 前端测试 | `format=markdown|json` 白名单；owner 校验；中性文件名、UTF-8 MIME、`.md`/`.json`、下载错误进既有 fault 路径；保持 `BaseResponse<String>`、无 PDF / 附件端点。 |
| C2 白名单多查询扩展 | `IMPLEMENTED_DEFAULT_OFF`（离线评测） | `scripts/evaluate_rag_query_expansion.py`、`evaluation/rag-query-expansion/corpus.json`、`scripts/tests/test_evaluate_rag_query_expansion.py`、`docs/plans/2026-11-14-rag-query-expansion-eval.md`、CI job | 零模型 / 零网络 / 零真实患者数据；仅受控别名，最多 2 探针，保留原查询和约束；OOD/QUALITY 零调用；合成召回收益不启用运行时扩展。 |

## 5. 失败与定向修复（累计）

1. `ToolExecutionInterceptor` 缺父类抽象 `getName()` → 补固定名称。
2. 合并流 `doFinally` 等不到终止（`statusEvents` 还开着）→ 改由 `graphEvents` 的 `doOnComplete/doOnError/doOnCancel` 触发 `sink.closePending()`。
3. pending 集合放在 `DiagnosisAgent` 会与工具线程竞态 → 收进每请求 `ToolStepSink` 的 `ConcurrentHashMap`。
4. 前端带 `toolCallId` 但非法状态的帧会降级成空结果卡 → fail-closed 丢弃；同时修正一处测试索引。
5. `MessageDTO` 新字段可被裸 `ObjectMapper` 写成 null → 加 `@JsonInclude(NON_NULL)` 并测旧帧形状。
6. `ToolAuditService.digestKey()` 配置缺失会 NPE → 固定开发回退字节；保留生产必须覆盖密钥的注释。
7. DB 审计异常可能经拦截器打断聊天 → `record()` 捕获 `RuntimeException`，只记 errorType；新增针对性测试。
8. V28 `UNIQUE(toolCallId, toolStatus)` 全局作用域过宽；发现时迁移已提交 / 应用，按规则不改已应用迁移，列为残余风险。
9. B1 预算 / 取消 / 总时长测试首轮夹具误把第二次脚本写成合法 JSON → 修正为第二次仍格式错误，精确驱动护栏；未放宽断言。
10. B2 显式标记佐证逻辑使旧测试夹具缺可信元数据 → 夹具补 `ownerUserId` / `documentId` / `corpus`，删除无效 `assertNull(null)`。
11. `npm` 工作树路径、`python` GBK、MySQL URL `/?`、GraphExecutionTest URL 带 query 等环境误用 → 分别用 `--prefix`、`python -X utf8`、CI 形态 `/diagnosis_ci` 与精确 `jdbc:mysql://127.0.0.1:3307/graph_execution_test` 修正。
12. 本机 Playwright 包期望 Chromium 1254 / headless shell 1254，本机只有 1234；`npm exec` 直接带 spec 参数也会被 CLI 吞掉。最终用 `npm exec -- playwright test --config <abs>` 转发参数、显式 `E2E_CHROMIUM_EXECUTABLE_PATH`、生产预览 `localhost:4173`，两组合计 13/13 通过。首次失败留下的 `test-results/` 已清理。
13. `python -m unittest discover -p "test_*.py"` 会加载需 `ISSUE17_MYSQL_CONTAINER` 的真实容器健康测试；未把它当脚本单测结果，也未跳过 / 伪造绿色，改跑 CI 所用的固定 `test_check_*.py` 与 `test_evaluate_*.py` 集合。

## 6. 最终独立审查

- 两个只读子代理分别审查后端 / 前端增量，最终均返回 `*_REVIEW_PASS`（`BACKEND_REVIEW_PASS` / `FRONTEND_REVIEW_PASS`），无 gate-blocking 缺陷；其结论只作源码审计，不替代测试证据。主会话独立复核 load-bearing 源码：`ToolExecutionInterceptor` 的 `handler.call()` 后才 `finished`、`ToolStepSink.closePending()` 只发 CANCELLED、`ToolAuditService.record()` 的异常隔离与 owner 断言、`SourceTypePolicy.restrict()` 只 filter 不 add、`DocumentSearchTool` 的 owner OR 过滤后调用、C1 `format` 白名单、`sessionExport.ts` 中性文件名、C2 脚本只 import argparse/hashlib/json/pathlib/time/typing、`FormatOnlyRetryPoc` 无 Spring bean 注解、application.yml 三个默认关闭开关。
- SAA 链式语义复核：JDK 21 `javap` 反汇编本地 `spring-ai-alibaba-agent-framework-1.1.2.2.jar`，确认 `Builder.interceptors(Interceptor...)` 是 `addAll` 追加、`DefaultBuilder.separateInterceptorsByType()` 按类型分流、`ReactAgent.collectAndMergeToolInterceptors()` 把显式工具拦截器全部加入后再按名称合并 hooks 提供的拦截器。本树 `DiagnosisAgent.buildAgent()` 未注册 hooks / 框架默认工具拦截器，新 observer 不会替换 HITL 链；`InterruptionMetadata` / `TOOL_CONFIRM` 处理不变。后端审查的非阻断观察已关闭。
- 敏感扫描：`git diff 7c028b80..20b620cc` 与 `git log` 命中项均为合成测试字符串、CI 一次性容器口令或既有配置占位符；无真实患者数据、无真实 API key、无私钥。hosted CI 日志亦无敏感内容。
- 代码树变更核查：协作 / patientdraft / 受控引用 / 患者授权 / R5 证据目录均为空 diff；`t_patient_authorization` 没有被当作外部文档授权凭证。

## 7. 残余风险 / 未完成

1. **需要新的最终合并审查**：PR #68 原有 `MERGE_READY` 已失效；本任务不执行合并。
2. `B1 POC_ONLY`：运行时缺少 durable per-attempt 幂等键与恢复语义证明；启用需 V29+ 记账表并联动 `DraftAgents.Transport.ask` / Coordinator 预算、取消、恢复、引用门禁，再独立验证。
3. `A2`：`ToolAuditService.listOwned` / `summarizeOwned` 尚无 REST 端点；审计持久化默认关闭，`AGENT_TOOL_AUDIT_DIGEST_KEY` 必须在任何启用环境独立配置。
4. V28 `UNIQUE(toolCallId, toolStatus)` 全局作用域过宽；如需收紧，新增 V29+ 并同步迁移矩阵、Flyway 测试、skip 契约、CI 与 `verify.sh`，不得改已应用 V28。
5. B2 存量 Chroma 未显式 SQL 回填；运行时保守推断，UNKNOWN fail-closed。`AUTHORIZED_EXTERNAL` 未实现准入，受控引用库审批 / 版本 / digest / 事务内复验未放宽；任何准入谓词变更需 ADR 与独立验证。
6. C2 合成语料召回 `0.25 → 1.0` 只是 instrument check；运行时 `DocumentSearchTool` 多查询扩展未接，不能用它声称线上收益。
7. `src/README.md:71-77` 可选来源标记说明未补，不影响代码门禁。
8. 医疗协作生产启用仍 `BLOCKED/未授权`；R5 一次性真实提供方实验保持封存，未重启。
9. 本机为 `CollaborationRunTest` 创建的 `collaboration_test` MySQL schema 属既有本地验证环境，本次未擅自清理；不属于 git 历史或产品部署。

## 8. 下一步可执行动作

1. 人类审阅 `docs/plans/2026-11-14-deepresearch-implementation-final.md` 与本报告。
2. 若决定合并 PR #68，先对**新代码树**做新的独立最终合并审查；审查通过后再由人类执行合并。
3. 若决定启用 A2 / B2 默认关闭项，分别补齐 REST / 密钥治理、V29 作用域修正、真实语料回填证据与配置评审；B1 需先补 durable per-attempt ledger，C2 需真实离线数据集证明收益。
4. 不执行：部署生产、启用医疗协作、重启 R5、调用真实模型、使用真实患者数据。

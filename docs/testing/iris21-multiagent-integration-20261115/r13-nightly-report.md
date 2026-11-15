# Iris Multi-Agent R1.3 · 夜间接力开发与验收报告

- 执行时间：2026-11-15 23:21 – 2026-11-16 00:10 +0800
- 执行角色：Claude Code 夜间集成负责人（独立工作树，未与 Codex 并发）
- 终态：**REVIEW_PASS**（独立只读审查 PASS_WITH_MINOR，无合并阻断项）
- 生产医疗协作：**BLOCKED**（合并 ≠ 启用；真实提供方 / 临床评估 NOT_RUN）

---

## 一、交接

| 项 | 值 |
| --- | --- |
| 交接信号 | `D:/Work/code/iris-integration-handoff/codex-ready.json`，`ready=true` |
| Codex 交接 SHA | `d66e6e22bb001188865e68805baa668c083b5988` |
| 交接分支 / 工作树 | `feat/iris21-multiagent-integration` / `.claude/worktrees/iris21-multiagent` |
| 交接工作树状态 | 干净（`git status --porcelain` 0 行），发布后冻结 |
| 报告 | `codex-final-report.md`，SHA-256 `3d9c2ddb…620fc` 与 `reportSha256` 一致 |
| UI 基线（已继承） | `b5f37e5cbbe66b440b2f907746735174ff817533`，ancestry 检查 exit 0 |
| 相对 UI | 106 commits / 433 changed files（与交接 JSON 一致） |
| 远端多 Agent | `01098ccb8d89afa464904489b6d2b1c268d56e83`，本地领先 2 个未推送提交 |
| 冻结 tag | annotated `iris-ui-v2.1-freeze-20261115`（tag 对象 `18f2bc11…`）→ commit `80f53f7f55955c2d30a1a9c98479dcb87682051b`，未移动 |
| 已知 P0/P1 | 0 |

交接前只读核对全部通过；未使用共享目录中旧的 `agent-ready.json` / `ui-ready.json` 作为本轮完成信号。

## 二、隔离与幂等

- 独占锁：`iris-integration-handoff/locks/d66e6e22bb001188865e68805baa668c083b5988/`，用 `mkdir` 原子创建，先到者持有；本轮无其它 RUNNING/终态记录。
- 夜间分支：`feat/iris21-multiagent-r13-nightly`
- 夜间工作树：`.claude/worktrees/iris21-multiagent-r13-nightly`（从交接 SHA 创建，非过期引用）
- 未修改 Codex 工作树、`ui`、`master`、PR #68 原分支、PR #87、冻结 tag。
- 未推送、未合并、未部署、未改生产开关、未调用 Codex。

## 三、Codex 三项改动的独立审查结论

### A. 创建游标与首次 SSE 订阅（`4f3645ae`）

**结论：修复正确、确定，无新竞态。**

- `create()` 在**受理事务内**、持有新 run 行排他锁时读取 snapshot（`CollaborationRunService.java:74-108`），`snapshot()` 的 `TransactionTemplate` 为 `PROPAGATION_REQUIRED`，加入同一事务；`run.accepted` 把 `seq` 推到 1，因此返回的 `snapshotSequence`/`resumeCursor` 就是提交水位本身，而不是“可能更晚”的 GET。
- COMMIT 后 `kick()` 才启动；`recoverPending()`（250ms 调度）在提交前看不到该行，提交后即使先跑也只会产生 `seq>1` 的事件，客户端从水位 1 订阅必然回放到 `run.started`。
- 幂等重试路径同样在行锁下取快照，语义等价于旧实现“那一刻的 GET”，不会回退。
- 前端：`admitted` 只在 `!forceRefresh && !view.run` 时使用一次（`useCollaborationRun.ts:116-130`）；重连沿用已推进的 cursor，`retry()`/`cancel()` 走 `connect(true)` 强制新 GET；StrictMode 第二次 effect 看到 `view.run` 非空，不再 GET；身份变化由 `CollaborationSession key={identityKey}` 整体重挂载（`CollaborationPage.tsx:187`），`admission` 不会跨账号复用；`admission?.runId === runId` + `newTask()` 清理保证不跨 run 复用。
- 去重：`collaborationReducer.ts:40` 丢弃 `sequence <= state.sequence`；回放顺序由服务端 `seq` 保证。
- 授权：AES-GCM cursor 绑定 `runId + userId + projection + seq + issued`；`read()` 校验篡改(400)/跨主体(400)/投影变化(409)/过期(410)；`subscribe`/`read`/每次 poll 与 send 都重新 `access()` + `requireLiveThread()`；患者与医生 cursor 不能互换。
- 测试真实性：新增 Java 测试用 `CountDownLatch` + `afterCommit()` 强制真实 `recoverPending()` 在 create 返回前提交 `run.started`，无 sleep；旧实现会在 `assertEquals(1, snapshotSequence)` 与 `assertEquals("ACCEPTED", …)` 处失败。前端测试用 mock + StrictMode，旧 hook 会调用 `snapshot` 并得到 `too-late-20`，同样会红。`FullApplicationAcceptanceTest.java:306` 的 `run.started` 断言保留未删。

### B. Issue #81 三条冒烟（`b9659a44`、`d8bc8f84`）

**结论：三条历史问题真正关闭，断言是加强不是削弱。**

- 资讯：旧的 `.chroma-card` 选择器换成 `getByRole("link", {name: title, exact: true})` + h1 + 非空 `.news-paper__body`，并核对真实列表/详情 id 与正文。
- 记录：读取真实 `/api/diagnosis/list/page/my` 响应；空态断言文案与 `.records__row` 数量，有数据时走真实列表 → 详情 id → `.sheet` / `.sheet__head` / `.sheet__verdict`。
- 普通 Agent：显式本地 SSE 夹具 + `generate-title` 桩，断言固定回复、发送内容、发送按钮恢复（该按钮只在 `!streaming` 时渲染）。
- `fixme-budget.json` = `max 0 / entries []`；`check-fixme.mjs` 拒绝未登记 fixme、超预算、缺原因、修好后未删条目与 `test.only`。缺凭证时 4 条如实 SKIP，不写成 PASS。
- 种子 SQL 仅限 `DATABASE()='diagnosis_ci'` + `BINARY userAccount=BINARY @smokeAccount` + `irisSmokeFixture%` 前缀，INSERT-only、固定主键，不更新/删除既有数据。

### C. UI 冻结保护

**结论：冻结范围逐字节保持，集成适配最小。**

| 文件 | HEAD blob | 冻结 tag blob |
| --- | --- | --- |
| `web/src/pages/AgentPage.tsx` | `df36b2de…7d6b` | `df36b2de…7d6b` |
| `web/src/styles/tokens.css` | `d5de71e4…ae45` | `d5de71e4…ae45` |
| `web/src/pages/LandingPage.tsx` | `d735107e…74f8` | 同左 |
| `web/src/pages/admin/*`、`components/admin/*` | 无差异 | — |

- Light/Dark 双主题：`tokens.css` 未变；新增 `collaboration.css` 的局部变量限定在 `.collaboration-page` 下，无 `:root` / `html.dark` 覆盖。
- 允许的集成适配：`ProductHeader.tsx` 仅加 `end={item.to === "/agent"}`；`navLinks.ts` 仅在 `VITE_COLLABORATION_ENABLED==="true"` 时插入“影像协作”，flag-off 输出与冻结基线完全一致。
- `ToolRequestMessage.tsx` 增加工具步骤状态（非 flag 门控）：属后端工具步骤契约适配，不是视觉重构；`/agent` 普通聊天在 flag-off 生产构建中已验证可用（见 §四）。仍需产品侧显式确认（见 §七）。

## 四、真实工程验证（全部在本机执行）

| 验证 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| TypeScript | `npx tsc -b` | PASS |
| ESLint | `npx eslint .` | PASS |
| fixme 预算 | `npm run check:e2e-fixme` | PASS（0/0） |
| Node 门禁与 Playwright 配置回归 | `npm run check:gate-tests` | PASS 6/6 |
| Vitest | `npx vitest run` | **637/637，66 文件，0 跳过**（整改后复跑） |
| Vite build（flag off） | `VITE_COLLABORATION_ENABLED=false npm run build` | PASS |
| 协作浏览器 | `playwright test e2e/collaboration.spec.ts` | **29/29**（合成 HTTP/SSE，非真实提供方） |
| 默认关闭 + 普通聊天 | flag-off 生产 preview + `collaboration-default-off.spec.ts` | **1/1**；无协作 API 请求，`/agent` 输入可用 |
| Issue #81 冒烟（空记录） | 真实后端 + 专用库种子 + `playwright test e2e/smoke.spec.ts` | **4/4** |
| Issue #81 冒烟（本人记录） | 种子记录后 `--grep 记录页` | **1/1**（整改 severity 后复跑仍 PASS） |
| 缺凭证路径 | 不传 `E2E_USER/E2E_PASSWORD` | **4 skipped**（如实记录，不写作通过） |
| 后端全量 `scripts/verify.sh` 第 3 次 | pass 1 全量单测 + `contextLoads` | **612 条：0 失败 / 0 错误 / 303 个 opt-in 跳过** |
| | pass 2 MySQL 集成门禁（空库 Flyway/上传/审计） | **7/7** |
| | pass 3 隔离库协作套件 | **303/303，0 跳过** |
| | 结束标记 | `==> verify green`，exit 0 |
| 应用级验收 | `FullApplicationAcceptanceTest`（真实 Spring Boot + Redis Session + SSE + 浏览器） | **7/7 PASS** |
| 图执行定向回归 | `GraphExecutionTest` | **37/37 PASS** |
| 协作确定性套件 | `CollaborationRunTest` | **33/33 PASS**（含新增受理游标用例） |
| 授权 / 恢复 | `PatientAuthorizationApiTest` 37、`DoctorReviewApiTest` 36、`PatientDraftTest` 41、`PatientExplanationApiTest` 37、`PatientFollowUpApiTest` 37、`ControlledReferenceApiTest`、`DiagnosisTaskRecoveryTest` | 全部 PASS |
| Hosted CI（最终本地 SHA） | 未推送 | **NOT_RUN**（用户禁令） |
| Hosted CI（远端 `01098ccb`） | Codex 记录 run 43729169948 | 20/20（**非本轮执行**，仅转述） |
| 真实模型 / 真实患者 / 临床评估 | — | **NOT_RUN**；生产医疗协作 **BLOCKED** |

### 失败与自我纠正（如实保留）

1. 首次 `verify.sh` 在 pass 1 失败：`chromaVectorStore` 无法初始化（本机未起 ChromaDB）。补齐 `chroma:1.0.0` 后重跑。
2. 第二次 `verify.sh` 的 pass 3 出现 `CoordinationMySqlTest` 3 failures + 2 errors（`NoClassDefFound` 子 JVM 类）。根因是**我自己**在同一个 `target/` 并发跑了 `mvn spring-boot:run`（会触发 `test-compile`），干扰 surefire 子进程。停止并发后第 3 次运行 **303/303 全绿**；该失败不计为产品缺陷，也不挪用第 3 次结果掩盖第 2 次的记录。
3. 时钟域：`verify.sh` 显式把容器与 JVM 都对齐 UTC（`JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`），本轮所有 Java 结果均为同一时钟域。未执行 WSL2/Windows 跨时钟域对比，也未用其它环境的通过结果替代。
4. 浏览器冒烟首次运行于 23:49 前后，使用 `diagnosis_ci` 一次性 Docker MySQL 8.0.26（端口 33307）+ Redis（36380）+ Chroma（8000），跑完容器已删除。

## 五、源码改动（夜间分支，相对交接 SHA）

```
 web/.gitignore                    | 1 +
 web/e2e/README.md                 | 4 +++-
 web/e2e/fixtures/smoke-record.sql | 2 +-
 web/package.json                  | 1 +
 web/src/styles/agent.css          | 9 ++++++---
 5 files changed, 12 insertions(+), 5 deletions(-)
```

| 改动 | 原因 | 来源 |
| --- | --- | --- |
| `package.json` 新增 `test:smoke`；README 改用该入口 | `npm run test:e2e` 会跑整个 `e2e/`（含协作专项与需要 `PRODUCT_ACCEPTANCE_LIVE` 的真实提供方用例），照旧文档会得到红灯 | 独立审查 #1 |
| `smoke-record.sql`：`MODERATE` → `moderate` | 大写不在前端 `severityLabel` 词表内，种子记录会渲染原始标签，测试等于在退化数据上通过 | 独立审查 #3 |
| `.gitignore` 增加 `test-results-*/` | 并行套件的输出目录未被忽略，存在误提交风险 | 独立审查 #8 |
| `agent.css` 工具状态色改用 `--brand-cyan` / `--brand-primary` / `--danger` | 原实现借用医学严重度 `--risk-*`，违反“三套语义色互不顶替” | 独立审查 #7 |

未改动：`src/main`、`src/test`、迁移 V1–V28、生产开关、冻结 UI 文件、任何既有测试断言。

## 六、独立审查

两位只读子代理审查实际 diff（不重复历史报告）：

- **review-cursor（受理游标 / SSE / 授权）**：PASS_WITH_MINOR。无 P0/P1，无新竞态，授权未削弱，无丢失/重复；测试是 latch/mock 驱动且会在旧代码上失败。P2：`admission` 消费后未清空（未来同 runId 重建会话会复用 seq-1 快照，fail-safe 但会重放旧时间线）；`initialSnapshot` 是对象身份 memo 依赖（当前调用方传稳定 state）；受理事务多持锁一小段时间；`docs/collaboration-runs.md` 未写明 POST 水位契约；测试中的“恢复抢先”是 afterCommit 模拟而非真实 250ms 扫描；刷新/深链会丢水位前的事件条目（状态正确，既有行为）。
- **review-tests-ui（#81 冒烟 / UI 冻结）**：PASS_WITH_MINOR。三条历史问题真实覆盖且断言加强；种子 SQL 隔离；缺凭证 SKIP 诚实；冻结文件逐字节一致。10 条 findings 中 #1/#3/#7/#8 已在本分支修复；#2（fixme 门禁不识别 `test.skip(true)`/`describe.skip`）、#4（空态与有记录是同一数据依赖测试的两个分支，流程未自动化）、#6（`ToolRequestMessage` 非 flag 门控，需产品确认）、#9（`ui-freeze-regression.spec.ts` 是粗门禁）、#10（CI 重复 lint，INFO）保留登记。

**独立审查结论：无合并阻断项；REVIEW_PASS。**

## 七、未解决问题与风险级别

| # | 级别 | 问题 | 处置 |
| --- | --- | --- | --- |
| 1 | MINOR | `ToolRequestMessage` 状态芯片对普通聊天全局生效，非 flag 门控 | 属后端工具步骤契约适配；需产品侧确认后再决定是否门控 |
| 2 | MINOR | fixme 门禁不识别 `test.skip(true)` / `describe.skip` | 当前树内无此类用法；后续硬化 |
| 3 | MINOR | 记录空态 / 有记录依赖两次不同种子，非单套件强制 | 流程已在 README 写明，未自动化 |
| 4 | MINOR | `admission` 消费后未清空（未来路径可能复用旧快照） | fail-safe（会从水位全量回放）；当前无触发路径 |
| 5 | MINOR | 受理事务持锁范围略增（含 cursor 签发与 review 读取） | 同 owner 受理本就串行，吞吐注记 |
| 6 | MINOR | `docs/collaboration-runs.md` 未写明 POST 水位契约 | 文档待补 |
| 7 | MINOR | `ui-freeze-regression.spec.ts` 只做溢出/主题/异常粗检，未接 CI | 已知；不当作像素门禁 |
| 8 | MINOR（既有） | `SameOriginFilter` 不比较 scheme | 未改白名单；沿用既有披露 |
| 9 | NOT_RUN | 最终本地 SHA 的 Hosted CI | 用户禁止推送；远端 `01098ccb` 的 20/20 不得当作本地 SHA 的证据 |
| 10 | BLOCKED | 生产医疗协作 / 真实提供方 / 临床评估 | 恒为 BLOCKED；需独立授权与临床评估 |

历史 `WP-C` 仍为 UNEXPLAINED，本轮通过不用于重写历史因果；PR #87 正文仍是旧 R1.2 文案，待授权后更新。

## 八、回并 PR #87 的建议

1. 以 `d66e6e22` 为父，把夜间分支的 1 个提交（5 文件、+12/−5）作为独立小 PR 或直接 cherry-pick 到 `feat/iris21-multiagent-integration`；不含任何功能改动。
2. 合并前补：最终 SHA 的 Hosted CI（需推送授权）、`docs/collaboration-runs.md` 水位契约说明、`ToolRequestMessage` 是否 flag 门控的产品决定。
3. 合并不等于启用：生产协作开关保持 `false`，真实提供方与临床评估另行授权。
4. 夜间工作树可保留供复核；如需清理，先确认分支已合并或明确丢弃，再删除 `.claude/worktrees/iris21-multiagent-r13-nightly`。

---

## 终态

```json
{
  "task": "iris21-multiagent-r13-nightly",
  "handoffSha": "d66e6e22bb001188865e68805baa668c083b5988",
  "nightlyBranch": "feat/iris21-multiagent-r13-nightly",
  "nightlyCodeSha": "ffb6ff4bb10204269282c2644fdcbb252520c830",
  "nightlyFinalSha": "见交接终态 JSON（本报告提交即分支最终提交）",
  "result": "REVIEW_PASS",
  "mergeBlockers": [],
  "productionMedicalCollaboration": "BLOCKED",
  "hostedCiFinalSha": "NOT_RUN",
  "realProviderOrClinical": "NOT_RUN"
}
```

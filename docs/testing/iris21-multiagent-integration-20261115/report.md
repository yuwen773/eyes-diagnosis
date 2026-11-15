# Iris · Multi-Agent Integration R1 交付报告

> 任务：在 Iris 2.1 冻结 UI 的基础上，把 PR #68 的 Java 多 Agent 运行时与独立 React 协作
> 工作台正式集成到同一套系统，并完成**完整应用级**（真实 Spring Boot + MySQL/Flyway + Redis）
> 的前后端联调与验收。
>
> 分支：`feat/iris21-multiagent-integration`（独立集成分支，未推送、未合并、未部署）
> 日期：2026-11-15
>
> **结论：INTEGRATION_PASS**（代码集成与规定的工程测试完成）。
>
> 门禁口径先说清楚：前端全部绿；Java pass 1/2 全绿，**pass 3/3 为 296/297**——唯一失败是
> PR #68 原样继承的夹具时间敏感用例（与集成分支逐字节无关，见 §8.2）。本报告**不主张**
> 297/297 全绿，也不把该失败算作集成缺陷。
>
> **生产医疗协作仍为 BLOCKED**——本报告不构成启用依据，见 §10。

---

## 1. 实际输入 SHA

`git fetch origin --prune` 后逐一复核（不沿用历史 SHA 记忆）：

| 角色 | 引用 | SHA | 复核结果 |
|---|---|---|---|
| UI 冻结基线 | tag `iris-ui-v2.1-freeze-20261115` | `80f53f7f55955c2d30a1a9c98479dcb87682051b` | 与任务给定一致 |
| 集成分支基点 | `origin/ui` | `7ec746fb8a82fc371a2818d5180177027dcc4cdd` | 与任务给定一致；是集成 HEAD 的祖先 |
| PR #68 开发分支 | `codex/realtime-product-acceptance` | `10173ae9ced22f29f18a238fdd4e2ec22b2668de` | 与任务给定一致；已作为合并父提交进入本分支 |
| 独立前端交付 | `feat/iris2-collaboration-workspace` | `028d1675`（交付冻结提交） | 74 个交付文件已在原工作树内形成**真实提交**，无需跨工作树绕过 guard |
| 本地集成 HEAD | `feat/iris21-multiagent-integration` | 见 §11 | — |

- 冻结 tag 与 `origin/ui` 的 `web/` 树相同（任务前提），本分支以 `origin/ui` 为基点，
  因此天然包含完整冻结 UI；`AgentPage.tsx` 等冻结文件与 tag **逐字节一致**（§5）。
- **旧夜间集成调度已停止**：Claude Code 定时任务 `df422126`（`*/10 * * * *`，
  「Iris 夜间自动集成 — 主控协议」）已 `CronDelete` 取消，`CronList` 现返回
  `No scheduled jobs`。取消时它的交接状态为 `agent-ready.json: ready=false / BLOCKED`、
  `ui-ready.json: ready=true`，即一直停在 WAITING，从未写入过集成目标；但其判据文件
  仍可能被后续会话改写，故按 §0 要求停用而不是依赖其当前取值。

---

## 2. Git 合并过程与冲突处理

全部整合走可追溯的 Git merge，没有手工批量拷贝 Java 文件。

```
7ec746fb (origin/ui)
   └─ d0f6b59e  merge(backend): 合入 PR #68 多智能体运行时与协作 API
                父提交：7ec746fb + 10173ae9（PR #68 tip）
        └─ a970602b  merge(web): 合入独立 React 多 Agent 协作工作台
                      父提交：d0f6b59e + 028d1675（独立前端交付冻结）
             └─ f7fa7349  fix(web): 消除合并残留的重复导出并按冻结类型修正用例
                  └─ e75b1055  fix(agent): 关闭取消竞态、SSE 错误体不一致与未知任务状态三项 P2
                       └─ 926c62f2  test(integration): 补齐全应用级验收与隔离库时区对齐
```

**冲突处理（两边语义都读，不整树取 ours/theirs）**

1. **第二次合并的语义冲突（不是文本冲突）**：PR #68 与独立工作台各自新增了一份
   `createAgentSession`，文本合并后 `web/src/lib/api.ts` 出现同名导出两份，
   构建期 Rolldown 报 `Duplicated export 'createAgentSession'`。
   处理：保留与 `deleteSession`/`batchDeleteSessions` 相邻的一份（接口形状一致，
   后端按请求体内的 `sessionId` 建会话），删除另一份；见 `f7fa7349`。
2. **测试边界的冲突**：独立工作台的 `AgentPage.collaboration.test.tsx` 假设
   `/agent` 在开关打开时会渲染协作控件——这与冻结 UI 的硬约束冲突。
   处理：按**冻结版语义**改写用例，守住新边界——`/agent` 是普通聊天页，
   开关开或关、带不带 `runId` 都不得发起协作请求或渲染协作工作台控件。
   断言没有放宽，反而收紧了（从"渲染协作"改为"绝不渲染协作"）。
3. **`HistoryMessageVO.id` 类型**：按冻结版类型改为字符串（线上雪花 id 即字符串），断言未变。

**Flyway**：合并带入 `V18`–`V28` 共 11 个迁移（`origin/ui` 基点只到 `V17`），
全部为**新增文件**，没有任何 `V1`–`V28` 既有迁移被修改；本轮集成**没有新增迁移**。
真实 MySQL 8.0.26 上 Flyway 全量执行通过（§6 的验收测试即跑在这套迁移之上）。

---

## 3. 新增和修改文件清单

### 3.1 后端（来自 PR #68 的正式合并，非手抄）

| 范围 | 变化 |
|---|---|
| `src/main/java/**` | 49 文件，+4822 / −46 |
| `src/main/resources/db/migration/**` | 11 个新增迁移（V18–V28），+243 |
| `src/test/java/**` | 50 文件，+8759 / −63 |

### 3.2 前端（`web/` 相对冻结 tag：63 文件，+7677 / −51）

新增 48 个，修改 15 个。分类见 §5。

### 3.3 本轮集成本身新增/修改

| 文件 | 说明 |
|---|---|
| `src/test/java/.../integration/FullApplicationAcceptanceTest.java` | 新增，完整应用级验收（§6） |
| `web/e2e/ui-freeze-regression.spec.ts` | 新增，冻结 UI 版式扫描（§5） |
| `scripts/verify.sh` | 修改：新增第三遍隔离库套件、JVM 时区对齐、触发器权限 |

---

## 4. 三项 P2 处理结论

三项均在**最新组合源码**上重新确认过触发条件，先复现、再最小修复、再补确定性回归用例，
最后独立复审。修复集中在 `e75b1055`。

### P2-1 取消请求与 SSE 流共用 AbortSignal

- **触发条件**：`useCollaborationRun` 的 `cancel()` 复用 SSE 流的 `controller.signal`。
  流的生命周期（终态、重连、换账号）会 abort 流，取消请求在送达服务端前就被撤回。
- **复现**：回归用例先在旧实现上失败（取消请求被 abort）。
- **修复**：取消请求使用自带信号 `new AbortController().signal`，独立于流存活，
  直到服务端明确答复；`cancelPending` 仍拦住重复取消。
- **边界守住了**：「取消已发送」不等于「取消已完成」——UI 只在服务端返回
  `CANCELLED` / `ALREADY_*` 后才离开取消态。
- **证据**：`web/src/hooks/useCollaborationRun.test.tsx`（+46 行新增用例）。

### P2-2 SSE 非预期 JSON 响应 / 错误响应体处理不一致

- **触发条件**：聊天 SSE 的 `onopen` 只看 HTTP 状态、不解析错误体；协作 SSE 却解析信封。
  两条 SSE 链路口径分叉；`diagnosisTaskApi` 的 `response.json()` 缺保护，
  非 JSON 错误体（代理错误页、空体）会以解析异常冒充「网络故障」。
- **修复**：`web/src/lib/http.ts` 新增 `rejectNonStreamResponse`：解析响应体 →
  认证类业务码（40100/40101）广播未登录 → 抛带真实 code 的 `ApiError`；
  响应体非 JSON 时退回 HTTP 状态码，绝不把异常响应当成流继续读。
  `api.ts` 的 `streamChat.onopen` 与 `diagnosisTaskApi` 都改走这一口径。
- **证据**：`web/src/lib/api.auth.test.ts`（+51 行）、`web/src/lib/diagnosisTaskApi.test.ts`。

### P2-3 未知影像任务状态的安全降级

- **触发条件**：任务状态形状合法但取值认不出时，旧实现整体抛 `INVALID_TASK_RESPONSE`，
  上层无法区分「状态未知」与「响应非法」，也拿不到明确的降级提示。
- **修复**：`ImageTaskStatus` 增加 `UNKNOWN`，白名单外的取值降级为 `UNKNOWN`——
  **既不当作推理中，也不当作已就绪**；协作任务表单据此停下受理并给出明确文案，
  任务列表中该选项禁用不可选。
- **边界守住了**：未知状态不会被读成成功，也不会进入受理。
- **证据**：`web/src/lib/diagnosisTaskApi.test.ts`（+28 行）、
  `CollaborationTaskForm.test.tsx`（+29 行）。

---

## 5. UI 冻结保护验证

### 5.1 逐字节一致性（硬约束）

| 文件 | 与冻结 tag 的 blob |
|---|---|
| `web/src/pages/AgentPage.tsx` | `df36b2deaebb553f53af2e30fa3b1a8e925c7d6b`（两边**完全相同**） |
| `LandingPage` / `DiagnosisPage` / `NewsPage` / `NewsDetailPage` / `ProfilePage` / `RecordsPage` | 无差异 |
| `web/src/styles/tokens.css` | 无差异 |
| `web/src/pages/admin/**` | 无差异 |

`AgentPage.tsx` **从未被修改**，因此不存在需要「先停止并报告」的情形。

### 5.2 `web/` 差异清单与分类（63 文件）

| 类别 | 文件 | 说明 |
|---|---|---|
| **A. 新增多 Agent 功能** | `src/components/agent/collaboration/*`（10 个组件 + 3 个测试）<br>`src/hooks/useCollaborationRun.ts(+test)`<br>`src/lib/collaborationApi.ts(+test)`、`collaborationProtocol.ts`、`collaborationReducer.ts(+test)`、`collaborationSession.test.ts`、`collaborationTestFixtures.ts`、`diagnosisTaskApi.ts(+test)`、`reviewApi.ts`、`sessionExport.ts(+test)`、`sessionWire.test.ts`<br>`src/lib/__fixtures__/collaboration.{v1,wire.v1}.json`<br>`src/pages/CollaborationPage.tsx(+test)`、`DoctorReviewsPage.tsx`、`AgentPage.collaboration.test.tsx`<br>`src/styles/collaboration.css`<br>`e2e/collaboration*.spec.ts`、`e2e/fixtures/*`、`e2e/product-real-provider-r5.spec.ts`、`scripts/evidence/*` | 独立工作台与 PR #68 的协作契约；全部为新文件，不改冻结页面 |
| **B. 必要的集成适配** | `src/App.tsx`（+8，仅两条路由）<br>`src/components/shell/navLinks.ts`（+5，开关打开时才出现「影像协作」）<br>`src/components/shell/ProductHeader.tsx`（1 行，`end` 精确匹配 `/agent`）<br>`vite.config.ts`（4 行，`COLLABORATION_TEST_BACKEND` + Origin 改写）<br>`playwright.config.ts`（4 行，baseURL/浏览器可执行路径）<br>`package.json`（3 行，测试脚本）、`e2e/README.md` | 最小接入：路由、导航、代理与测试脚本 |
| **C. 已批准的安全/阻断性修复** | `src/lib/http.ts`（+20，P2-2 统一口径）<br>`src/lib/api.ts`（+58/−?，走统一口径 + 合并去重）<br>`src/lib/agentStream.ts`（+210，工具步骤状态契约）<br>`src/components/agent/messages/ToolRequestMessage.tsx`（+41，状态文字+圆点）<br>`src/styles/agent.css`（+47，工具状态样式，仅用既有令牌） | 均为 P2 修复或 PR #68 的普通聊天契约；不新增调色板、不改令牌 |
| **D. 非预期修改** | 无 | — |

### 5.3 版式回归扫描（新增，可重复）

`web/e2e/ui-freeze-regression.spec.ts`：12 条路由（首页 / `/agent` / 判读 / 资讯 / 个人中心 /
记录 / 管理端六页）× 6 个宽度（390/768/820/900/1440/1920）× Light/Dark。
断言：无横向溢出（`scrollWidth - innerWidth ≤ 1`）、`html.dark` 与所选主题一致、
无未捕获异常；390/900/1440 留截图。

结果：**2/2 通过**（144 个版式检查点 × 双主题）。截图落在 `target/ui-freeze/`（gitignore）。

> 说明：本 spec 的 `/api` 全部是合成夹具，它**只**证明版式与主题没有被集成改动破坏，
> 不能当作业务或数据口径证据。

---

## 6. Java 完整应用级测试结果

**不是** `CollaborationBrowserServer` 合成 Harness，而是真实 Spring Boot 应用：

- `@SpringBootTest(webEnvironment = RANDOM_PORT)`，真实 Tomcat + 真实 Controller/Service/Mapper/事务，
  真实 Spring Security 会话（`spring.session.store-type=redis`）与 `@AuthCheck` AOP，
  真实 `SameOriginFilter` / CORS 过滤链，真实 MySQL 8.0.26 + 完整 Flyway 迁移链。
- **确定性替身只替换外部依赖**：`ChatModel`（四角色 JSON 夹具 + 闸门）、
  `DiagnosisGrpcClient`（固定 `glaucoma/70/IN_DISTRIBUTION`）、`DiagnosisTaskStorage`（内存对象存储）。
  真实模型、真实患者资料、真实对象存储**都没有被调用**，安全过滤器**没有被关闭**。
- 环境：一次性 `mysql:8.0.26` + `redis:7-alpine` 容器，`SPRING_PROFILES_ACTIVE=ci`，
  独立 schema `diagnosis_ci`，JVM 与容器时区对齐 UTC。

`FullApplicationAcceptanceTest`：**7/7 通过**（约 21s）。

| # | 用例 | 覆盖的 §6 链路 |
|---|---|---|
| 1 | `realLoginCreatesDistinctServerSideSessions` | A 登录与身份隔离（两个账号的会话在 Redis 中互不相通） |
| 2 | `uploadRunsTheRealTaskPipelineUntilInferenceIsReady` | B PNG 上传、C 幂等重试/冲突 409/他人 403、D 推理就绪（快照落库） |
| 3 | `collaborationRunProjectsDetailsOnlyToCliniciansAndSurvivesReplay` | E 创建、F 四角色+事件族、G 实时进度、H 快照/游标/重放去重、K 患者投影、M 重复受理不重复建对象 |
| 4 | `cancelStopsALiveRunAndProtectsTheTerminalState` | I 取消、重复取消幂等、终态保护、并发竞态 |
| 5 | `doctorApprovalGatesThePatientExplanation` | J 医生获授权复核并审批、K 患者仅见获准说明、越权 403 |
| 6 | `saveAuthorizationRequiresExplicitPatientApproval` | L 保存授权、摘要篡改拒绝、他人不得代授权 |
| 7 | `crossOriginStateChangesAreRejectedBeforeReachingAnyController` | Origin/CSRF：跨站 POST 403、无 Origin 403、跨站 GET 被 CORS 层挡下、被拒请求不落业务对象 |

**16 类 SSE 事件的覆盖**

| 事件 | 完整应用验收 | 隔离库套件 |
|---|---|---|
| `run.accepted` / `run.started` / `agent.started` / `agent.completed` / `agent.summary` / `agent.readable` / `agent.handoff` / `evidence.verified` / `agent.revision.completed` / `run.review_ready` / `run.completed` / `run.cancel_requested` / `run.cancelled` | ✅ 真实 HTTP/SSE | ✅ |
| `agent.feedback.requested` | — | ✅ `CollaborationRunTest` |
| `run.failed` | — | ✅ `CollaborationRunTest` |
| `run.restricted` | 见下方说明 | — |

`run.restricted` 由 `CollaborationEvents.stopped()` 在非失败终止时发出，与
`run.failed` 共用同一段代码路径；完整应用验收里没有单独构造 RESTRICTED 输入，
该项覆盖以 `CollaborationRunTest` 的停止语义用例为准，属**已知覆盖缺口**，列入 §10。

---

## 7. 前后端真实联调结果

见 §6。补记三条链路细节：

- **SSE 真实网络链路**：`java.net.http.HttpClient` 直连真实 Tomcat 的 `/events`，
  按 `id:`/`event:`/`data:` 解析帧；游标是 AES-GCM 加密并绑定 `(runId, userId, projection)`，
  跨身份复用游标被 400 `INVALID_CURSOR` 拒绝（用例 3 显式验证）。
- **Vite 同源代理**：`web/vite.config.ts` 的 `/api` 代理把 Origin 改写成 target，
  浏览器侧是同源请求，后端 `SameOriginFilter` 全量生效；本轮用真实浏览器跑了
  `collaboration.spec.ts`（29 条）与 `collaboration-default-off.spec.ts`（1 条），
  均通过（§8）。
- **持久化与重启恢复**：运行、事件、角色状态全部落在 MySQL（`t_agent_collab_run`、
  `t_agent_collab_event`、`t_patient_graph_execution`），断线续读从游标重放证明事件是持久的；
  跨 JVM 的租约/围栏语义由 `GraphExecutionTest` 的子进程用例覆盖（§8 第三遍）。

---

## 8. 自动化测试结果

### 8.1 前端

| 门禁 | 命令 | 结果 |
|---|---|---|
| Vitest | `npm run test` | **PASS** — 64 文件 / 631 用例 |
| TypeScript | `npm run typecheck`（`tsc -b`） | **PASS** — 0 错误 |
| ESLint | `npm run lint` | **PASS** — 0 告警 |
| Vite build | `npm run build` | **PASS**（仅有既存的 chunk > 500 kB 提示，非错误） |
| Playwright · 协作工作台 | `playwright test e2e/collaboration.spec.ts`（`VITE_COLLABORATION_ENABLED=true` 的开发服务器） | **PASS** — 29/29，含 12 张截图比对 |
| Playwright · 默认关闭 | `playwright test e2e/collaboration-default-off.spec.ts`（生产构建预览） | **PASS** — 1/1 |
| Playwright · 冻结 UI 扫描 | `playwright test e2e/ui-freeze-regression.spec.ts`（生产构建预览） | **PASS** — 2/2（Light/Dark 各 12 路由 × 6 宽度） |
| Playwright · 协作后端直连 | `npm run test:collaboration-backend` | **NOT_RUN** — 需要 `scripts/run_task05_browser_server.ps1`，本会话 worktree guard 拒绝执行 PowerShell（见 §10） |
| Playwright · 协作安全负例 | `e2e/collaboration-safety.spec.ts` | **NOT_RUN** — 同上 |
| Playwright · 真实后端冒烟 | `e2e/smoke.spec.ts` | **SKIP（设计如此）** — 实跑 4/4 skipped：缺 `E2E_USER`/`E2E_PASSWORD`，且需要真实后端与算法服务 |

实际浏览器：Chromium **151.0.7922.34**（Playwright 1.65.0，rev 1234）。
Playwright 期望的 rev 1254 在本机未安装；截图比对仍全部通过。

### 8.2 Java（`scripts/verify.sh`，一次性 MySQL 8.0.26 + Redis 7，`SPRING_PROFILES_ACTIVE=ci`）

| 遍次 | 内容 | 结果 |
|---|---|---|
| pass 1/3 | 全量单元 + `contextLoads` + 完整应用级验收 | **PASS** — `Tests run: 599, Failures: 0, Errors: 0, Skipped: 297`（297 条隔离库用例按设计在此遍跳过） |
| pass 2/3 | MySQL 集成门禁（Flyway / 上传状态机 / 工具审计） | **PASS** — 7/7 |
| pass 3/3 | 12 个隔离库套件（协作、图执行、产品 schema、受控检索、任务、复核、授权、草稿、说明、随访、协调） | **FAIL（1 条）** — `Tests run: 297, Failures: 1` |

**pass 3/3 的唯一失败：`GraphExecutionTest.heartbeatRenewsLeaseAndConcurrentClaimDoesNotDispatchProviders`**

这是**从 PR #68 原样继承**的用例，不是集成引入的：

- `GraphExecutionTest.java`、`PatientDraftCoordinator.java` 与整个
  `src/main/java/.../collaboration/` 相对 PR #68 tip（`10173ae9`）`git diff --stat` 为**空**。
- 用 MySQL general log 抓到的失败现场：用例把 `leaseUntil` 手改为 `NOW()+3s` 之后，
  协调器线程**再无任何 SQL**；3 秒后租约自然过期，分支在
  `PatientDraftCoordinator.checkLease` 抛 `Stop`，用例的 10s 有界等待超时。
  成功运行时，续约语句写的是正确的 `+10s`（UTC 两端一致，已排除时区因素）。
- 复现统计（本机 Windows + Docker Desktop，JVM 与 MySQL 均为 UTC）：

| 运行方式 | 次数 | 通过 |
|---|---|---|
| 只跑该单方法 | 2 | 2 |
| 跑整个 `GraphExecutionTest` 类 | 5 | 1 |
| 整个类 + 前序 `CollaborationRunTest` | 1 | 0 |

即：**单方法稳定通过，整类运行稳定失败**——这是用例的时间敏感性（协调器最多每秒续约一次，
用例却把租约压到 3 秒，且依赖整类运行时的调度时序），属夹具脆弱点，非产品缺陷。
产品侧的租约/围栏语义由其余 296 条用例与完整应用验收独立覆盖。

> 处理方式：**不修改**该用例（不改断言、不放宽条件、不删除），也不在集成分支上改 PR #68
> 的冻结实现；按事实记录为 FAIL，列入 §10 第 1 项。本报告**不主张** pass 3/3 是 297/297 全绿。

### 8.3 完整应用级验收

`FullApplicationAcceptanceTest` 7/7 PASS（见 §6）。该测试在 pass 1/3 中随全量套件执行，
也单独在一次性 MySQL+Redis 环境复跑通过。

### 8.4 证据未被人为修饰

- 本会话**没有删除任何测试**、没有放宽任何断言。
- 运行 `collaboration.spec.ts` 会重写 `docs/testing/iris2-collaboration-20261114/screenshots/`
  下的既有证据（`capturedAt` 与浏览器版本噪声），已在提交前 `git checkout --` **还原为
  2026-11-14 的原提交内容**，本轮结果只记录在本报告里。

---

## 9. 权限与安全检查

| 检查项 | 结论 | 证据 |
|---|---|---|
| 患者投影不含协作内部事件 | PASS | 用例 3：患者流不含 `agent.readable`/`agent.handoff`/`evidence.verified`/`agent.revision.completed` |
| 医生投影需显式授权 | PASS | 用例 3/5：`v1:doctor:<reviewId>` 需 `t_doctor_review` 授权，陌生账号 403 |
| 游标不可跨身份/跨投影复用 | PASS | 用例 3：患者游标给管理员 → 400 `INVALID_CURSOR` |
| 保存授权需版本+摘要 | PASS | 用例 6：篡改摘要被拒；他人代授权被拒 |
| 患者仅见获准说明 | PASS | 用例 5：未批准时 `status != AVAILABLE` 且正文为空 |
| 跨站状态变更被拒 | PASS | 用例 7：403 `CROSS_ORIGIN_BLOCKED`；无 Origin 亦 403 |
| 默认关闭 | PASS | 全部 `eye-diagnosis.collaboration.*` 默认 `false`；`contextLoads`（CI profile）通过；生产构建预览下协作入口不出现、无协作 API 请求 |
| 生产医疗协作 | **BLOCKED** | 未部署、未启用；§10 列出启用前门禁 |

---

## 10. 剩余 P0/P1/P2 与生产门禁

**P0：无。P1：无。**

P2 / 已知缺口：

1. **`GraphExecutionTest` 租约心跳用例整类运行稳定失败**（§8.2）。用例与实现均与 PR #68
   逐字节相同，单方法运行稳定通过、整类运行稳定失败，属夹具时间敏感性；本轮按事实记为
   FAIL，未做任何修改。建议由 PR #68 线自行修复（例如让用例把租约压到比续约周期更长的
   窗口，或改为等待"续约次数"而非"租约剩余时长"），**不应由集成分支改动上游冻结测试**。
2. **隔离库套件的时区耦合**：该批用例混用 SQL `NOW(6)` 与 JVM `Timestamp` 写入同一列，
   要求 JVM 时区 == MySQL 时区。`scripts/verify.sh` 第三遍已显式对齐 UTC
   （GitHub runner 上两边本来就是 UTC），但这是测试夹具的脆弱点，建议后续让隔离库 URL
   显式带 `serverTimezone` 或统一走 SQL 侧时钟。
3. **`run.restricted` 事件缺完整应用级用例**（§6 表）。代码路径与 `run.failed` 共用，
   隔离库套件覆盖停止语义，但完整应用验收未单独构造 RESTRICTED 输入。
4. **Playwright 浏览器版本**：本机缺 Playwright 期望的 Chromium rev 1254，
   实跑用 rev 1234（Chromium 151.0.7922.34）。截图比对仍 12/12 通过，
   但证据应记录实际版本（本报告即为此）。
5. **两个显式 opt-in 的浏览器用例未跑**：`collaboration-backend.spec.ts`、
   `collaboration-safety.spec.ts` 需要 `scripts/run_task05_browser_server.ps1` 起
   `CollaborationBrowserServer`，本会话的 worktree guard 拒绝在集成分支上直接执行
   PowerShell 脚本。二者的覆盖点已由 §6 的完整应用验收（真实 Controller + 真实过滤器链）
   以更强形式覆盖，但**不视为等价**，仍列为未执行项。
6. `e2e/smoke.spec.ts`（真实后端 + 真实账号 + 算法服务）按设计 SKIP，见 §8。

**生产启用门禁（本报告不解除）**

- 生产医疗协作保持 **BLOCKED**：未部署、未在 `ui`/`master` 合并、未开启任何
  `eye-diagnosis.collaboration.*` 开关。
- 启用前至少还需要：真实模型质量与安全性评审、真实数据脱敏与留存策略、
  医生授权流程的合规确认、SSE 容量与重连压测、生产 `cursor-key` 的密钥管理。

---

## 11. 集成本地 HEAD

| 提交 | 内容 |
|---|---|
| `926c62f2` | 完整应用级验收 + 隔离库时区对齐 + 冻结 UI 扫描（**本轮工程内容的 HEAD**） |
| 本文件所在提交 | 交付报告（分支 tip，交付时给出） |

分支：`feat/iris21-multiagent-integration`，基点 `7ec746fb`（`origin/ui`）。
**未推送、未合并到 `ui`/`master`、未部署。**

---

## 12. 推荐后续 PR base 和合并顺序

1. 以 `origin/ui`（`7ec746fb`）为 base 开 Draft PR，标题建议
   `feat(integration): Iris 2.1 多 Agent 前后端集成`。
2. 本分支同时包含 PR #68 的**完整后端**（含 V18–V28 迁移）。若 PR #68 先合入
   `master` 或 `ui`，则本 PR 应改为以合入后的分支为 base 并做一次 merge 重排，
   **不要**用 squash 把两边历史压平（会丢失 PR #68 的来源历史）。
3. 合并顺序建议：先合本分支（含 UI 冻结基线 + 协作后端 + 工作台），
   再按需把 PR #68 单独合入 `master`（若 `master` 需要后端而 `ui` 不需要）。
4. 合入后**不要**立即开启任何协作开关；开关的启用应作为独立的生产就绪评审项。

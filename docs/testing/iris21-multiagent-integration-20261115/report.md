> **2026-11-15 R1.2 收口（本轮，最新）**：R1.1 的唯一未闭环项（WP-C 历史现场因果）已完成
> 归因收口——**机制由确定性回归确立，历史现场本身判定为 UNEXPLAINED**（原始 general log 与
> 数据库已被第一次审查删除，不可再取证，不以推测替代结论）；
> **§3.2 / §5.2 / §8.1 / §8.2 / §10 第 1、5 项已按当前事实重写**。
> **独立审查结论：`REVIEW_PASS`**（审查对象 `4aaf315d`）；审查提出的 5 处文档异议已逐条修正。
> 详见 [R1.2 可靠性与审查收口报告](r12-reliability-closure.md)。
>
> **2026-11-15 R1.1 更正：当时总体 REQUEST_CHANGES。** 七项整改、Graph 确认缺陷与未解历史因果、最终验证及新 HEAD 以 [R1.1 整改报告](r11-remediation.md) 为准。本文以下是历史 R1 记录；“继承失败所以只是夹具问题”的结论已撤回，历史 INTEGRATION_PASS 不构成当前 REVIEW_PASS。
>
> **2026-11-15 晚间更新**：隔离库夹具的未池化数据源已修复并整合回本分支，
> **§8.2 / §10 第 1 项 / §11 已按事实重写**；其余章节仍为 R1 记录。

# Iris · Multi-Agent Integration R1 交付报告

> 任务：在 Iris 2.1 冻结 UI 的基础上，把 PR #68 的 Java 多 Agent 运行时与独立 React 协作
> 工作台正式集成到同一套系统，并完成**完整应用级**（真实 Spring Boot + MySQL/Flyway + Redis）
> 的前后端联调与验收。
>
> 分支：`feat/iris21-multiagent-integration`（独立集成分支；**已推送**并建 Draft PR #87，
> base = `ui`；**未合并、未部署**）
> 日期：2026-11-15
>
> **结论（工程门禁口径）：INTEGRATION_PASS**（代码集成与规定的工程测试完成）。
> **边界**：`scripts/verify.sh` 在本机 Docker 上 pass 3 未全绿（302 跑 / 3 失败），
> **不记 PASS**；这 3 条已归因为跨时钟域的测试前置条件，见 §8.2 与
> [r12 §3.2](r12-reliability-closure.md)。
> **评审口径**：**R1.2 独立审查结论为 `REVIEW_PASS`**（审查对象 `4aaf315d`，
> 见 [r12-reliability-closure.md](r12-reliability-closure.md) §4.4 与本文 §10）。
> 审查通过**不等于**生产启用依据；历史 Docker 现场的因果不再是「未闭环缺陷」，
> 而是**证据边界（UNEXPLAINED）**。
>
> 门禁口径先说清楚：前端全部绿；Java **pass 1 与 pass 2 在真实 Docker 容器上全绿**
> （611 / 7），**pass 3 在真实 Docker 上是 302 跑、3 失败**——3 条都是「构造受控时差/截止时间」
> 的前置条件，归因为本机 WSL2 容器与 Windows 宿主两个时钟域（见 §8.2 与
> [r12 §3.2](r12-reliability-closure.md)）；同一批套件在**原生 MySQL（与 JVM 同一时钟域）上是
> 302/302**。上一轮 pass 3 的唯一失败是隔离库夹具的未池化数据源，**已在 PR #68 原线上修复**
> （不是在本分支上改上游），验证通过后整合回本分支（详见 §8.2）。
> 本报告**不主张**生产医疗协作可启用，见 §10。
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
| `src/main/java/**` | 50 文件，+4877 / −47 |
| `src/main/resources/db/migration/**` | 11 个新增迁移（V18–V28），+243 |
| `src/test/java/**` | 53 文件，+10080 / −63 |

（数字按**当前集成分支 tip** 对 `origin/ui` 重算；R1 交付时（`31f30ddc`）为 49 / +4822 / −46 与
50 / +8759 / −63，R1.1 与 R1.2 又增加了测试与夹具改动。）

### 3.2 前端（`web/` 相对冻结 tag：65 文件，+7866 / −51）

新增 50 个，修改 15 个，删除 0 个。分类见 §5。

> 数字按**当前集成分支 tip** 重算。R1 交付时（`31f30ddc`）该数为 63 文件 / +7677 / −51；
> R1.1 的 WP-A（`useCollaborationRun` 修复循环）与 WP-B（`collaborationLabels`、`DoctorReviewsPage`）
> 又改动了 8 个 `web/` 文件，因此本表已更新为当前值。

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

### 5.2 `web/` 差异清单与分类（65 文件）

| 类别 | 文件 | 说明 |
|---|---|---|
| **A. 新增多 Agent 功能** | `src/components/agent/collaboration/*`（13 个文件：9 个实现 + 4 个测试）<br>`src/hooks/useCollaborationRun.ts(+test)`<br>`src/lib/collaborationApi.ts(+test)`、`collaborationProtocol.ts`、`collaborationReducer.ts(+test)`、`collaborationSession.test.ts`、`collaborationTestFixtures.ts`、`diagnosisTaskApi.ts(+test)`、`reviewApi.ts`、`sessionExport.ts(+test)`、`sessionWire.test.ts`<br>`src/lib/__fixtures__/collaboration.{v1,wire.v1}.json`<br>`src/pages/CollaborationPage.tsx(+test)`、`DoctorReviewsPage.tsx(+test)`、`AgentPage.collaboration.test.tsx`<br>`src/styles/collaboration.css`<br>`e2e/collaboration*.spec.ts`、`e2e/fixtures/*`、`e2e/product-real-provider-r5.spec.ts`、`scripts/evidence/*` | 独立工作台与 PR #68 的协作契约；全部为新文件，不改冻结页面 |
| **B. 必要的集成适配** | `src/App.tsx`（+8，仅两条路由）<br>`src/components/shell/navLinks.ts`（+5，开关打开时才出现「影像协作」）<br>`src/components/shell/ProductHeader.tsx`（1 行，`end` 精确匹配 `/agent`）<br>`vite.config.ts`（4 行，`COLLABORATION_TEST_BACKEND` + Origin 改写）<br>`playwright.config.ts`（4 行，baseURL/浏览器可执行路径）<br>`package.json`（3 行，测试脚本）、`e2e/README.md` | 最小接入：路由、导航、代理与测试脚本 |
| **C. 已批准的安全/阻断性修复** | `src/lib/http.ts`（+20，P2-2 统一口径）<br>`src/lib/api.ts`（+58/−?，走统一口径 + 合并去重）<br>`src/lib/agentStream.ts`（+210，工具步骤状态契约）<br>`src/components/agent/messages/ToolRequestMessage.tsx`（+41，状态文字+圆点）<br>`src/styles/agent.css`（+47，工具状态样式，仅用既有令牌） | 均为 P2 修复或 PR #68 的普通聊天契约；不新增调色板、不改令牌 |
| **D. 非预期修改** | 无 | — |

> R1.1 相对 R1 的 `web/` 增量（8 文件，+210 / −21）全部落在 A 类之内：
> `useCollaborationRun.ts(+test)`（协议修复循环）、`collaborationLabels.ts(+test)`（Critic 语义）、
> `DoctorReviewsPage.tsx(+test)`（冻结 Vision 材料白名单）、`e2e/collaboration-backend.spec.ts`、
> `e2e/collaboration-safety.spec.ts`（入口改到独立协作工作台）。仍无 D 类改动。

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
- 环境：与 CI 同构的一次性 `mysql:8.0.26` + `redis:7-alpine` 容器。本会话 Docker 恢复后，
  `scripts/verify.sh` 的 **pass 1 就是用这套容器实跑的**，`FullApplicationAcceptanceTest`
  在 `ci` profile 下连的是 `jdbc:mysql://127.0.0.1:33306/diagnosis_ci`，7/7 通过。
  Docker 失效期间另有一次明确标注的等价替代（原生 MySQL 8.0.26 + 原生 Redis + 最小 Chroma
  HTTP 夹具），同样 7/7。详见 §8.2 的环境说明。

`FullApplicationAcceptanceTest`：**7/7 通过**（`Tests run: 7, Failures: 0, Errors: 0, Skipped: 0`，
用例耗时 6.5 s；连同 Spring 上下文启动的整段约 21 s）。

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
| Vitest | `npm run test` | **PASS** — 66 文件 / 636 用例 |
| TypeScript | `npm run typecheck`（`tsc -b`） | **PASS** — 0 错误 |
| ESLint | `npm run lint` | **PASS** — 0 告警 |
| Vite build | `npm run build` | **PASS**（仅有既存的 chunk > 500 kB 提示，非错误） |
| Playwright · 协作工作台 | `playwright test e2e/collaboration.spec.ts`（`VITE_COLLABORATION_ENABLED=true` 的开发服务器） | **PASS** — 29/29，含 12 张截图比对 |
| Playwright · 默认关闭 | `playwright test e2e/collaboration-default-off.spec.ts`（生产构建预览） | **PASS** — 1/1 |
| Playwright · 冻结 UI 扫描 | `playwright test e2e/ui-freeze-regression.spec.ts`（生产构建预览） | **PASS** — 2/2（Light/Dark 各 12 路由 × 6 宽度） |
| Playwright · 协作后端直连 + 安全负例 | `playwright test e2e/collaboration-backend.spec.ts e2e/collaboration-safety.spec.ts --workers=1`（`CollaborationBrowserServer` 真实 HTTP/SSE） | **PASS** — 5/5（0 跳过） |
| Playwright · 医生 Vision 定向 | 真实 React DOM + 合成授权材料 HTTP | **PASS** — 摘要/两限制/RECAPTURE 可见，隐藏字段不见 |
| Playwright · 真实后端冒烟 | `e2e/smoke.spec.ts` | **SKIP（设计如此）** — 实跑 4/4 skipped：缺 `E2E_USER`/`E2E_PASSWORD`，且需要真实后端与算法服务 |

实际浏览器：Chromium **151.0.7922.34**（Playwright 1.65.0，rev 1234）。
Playwright 期望的 rev 1254 在本机未安装；截图比对仍全部通过。

> 上表数字按 **R1.1 之后的当前候选**（`c2815fcd` / `e4e13aad`）重跑所得；R1 交付时（`31f30ddc`）
> 为 64 文件 / 631 用例，协作后端直连与协作安全负例两条当时为 `NOT_RUN`。
> 这两条在 R1.1 里已跑通并通过（入口改为独立协作工作台，未删业务断言、未扩大超时）。
> 详见 [r11-remediation.md](r11-remediation.md) 的「验证结果与环境边界」表。
>
> **本轮（R1.2）前端零改动**：`git diff --stat 0c3d0aec..5d7afd11 -- web/` 为空（该区间只有本轮
> 的测试与门禁改动），上表结论沿用 R1.1 的实跑证据。

### 8.2 Java（`scripts/verify.sh` 三遍；`SPRING_PROFILES_ACTIVE=ci`）

> **环境事实（必读，不得省略）**：本会话前期 Docker Desktop 的 WSL2 引擎失效
> （`Docker Desktop is unable to start`），当时记为 BLOCKED_ENV；**会话中途恢复，本轮已用
> 原样的 `scripts/verify.sh` 真跑过三遍**（一次性 `mysql:8.0.26` + `redis:7-alpine`，
> `SPRING_PROFILES_ACTIVE=ci`）。实跑结果：
> **pass 1 ✅ 611 / pass 2 ✅ 7/7 / pass 3 ❌ 302 跑、3 失败**。
> **`scripts/verify.sh` 在本机没有全绿，因此不记 PASS。**
>
> 那 3 条失败全部在 `GraphExecutionTest`，且都是「构造受控时差/截止时间」的前置条件：
> 本机 MySQL 在 WSL2 虚拟机里、JVM 在 Windows 宿主上，是两个时钟域，实测偏移在 1–3.5 s 之间漂移
> （两次独立运行由断言值反推：**数据库比宿主快 3189 ms 与 2463 ms**；直接取样也测到容器比宿主快
> 1358 ms，方向一致）。把 JVM 放进与 MySQL 同一时钟域
> 复跑同一批 12 个套件，这 3 条**全部转绿**，但同一次运行暴露了另一条有界等待抖动
> （`heartbeatRenewsLease…`，10 s 有界等待未满足，近因未定位）。
> 详见 [R1.2 报告 §3.2](r12-reliability-closure.md)。**未删除测试、未放宽断言、未延长超时。**
>
> 表中标「原生替代」的那一行来自 Docker 失效期间做的**明确标注的等价替代**跑法：
> 把一次性容器换成原生 MySQL 8.0.26（3307，同引擎版本）+
> 原生 Redis（36419）+ 最小 Chroma HTTP 夹具（只应答 `ChromaVectorStore` 初始化时的那一次
> collection GET，其余 501；**不做向量检索、不调嵌入，不等于真实 Chroma / RAG 验收**），
> 服务端 `time_zone` 运行期置 `+00:00`。它的 pass 3 是 302/302，但**原生 MySQL 与 JVM
> 在同一时钟域**，这正是 Docker 那 3 条失败不出现的原因。
>
> **不能**把本轮写成「Docker 三遍通过」——pass 3 在本机 Docker 里没有全绿。

| 遍次 | 运行方式 | 内容 | 结果 |
|---|---|---|---|
| pass 1/3 | **真实 Docker**（`scripts/verify.sh` 原样） | 全量单元 + `contextLoads` + 完整应用级验收 | **PASS** — `Tests run: 611, Failures: 0, Errors: 0, Skipped: 302`（302 条隔离库用例按设计在此遍跳过） |
| pass 2/3 | **真实 Docker** | MySQL 集成门禁（Flyway / 上传状态机 / 工具审计） | **PASS** — 7/7 |
| pass 3/3 | **真实 Docker** | 12 个隔离库套件 | **FAIL** — `Tests run: 302, Failures: 3, Errors: 0, Skipped: 0`（3 条全部在 `GraphExecutionTest`，归因见 r12 §3.2） |
| pass 3/3 | 原生替代（MySQL 8.0.26 与 JVM **同一时钟域**） | 12 个隔离库套件（协作、图执行、产品 schema、受控检索、任务、任务恢复、复核、授权、草稿、说明、随访、协调） | **PASS** — `Tests run: 302, Failures: 0, Errors: 0, Skipped: 0` |

> **CI `backend-unit` job 的本地等价跑法**：`mvn test`（**不**带 `-Dtest` 过滤）、只设
> `SPRING_PROFILES_ACTIVE=ci`、**不**给任何隔离库 URL（`FLYWAY_TEST_URL` / `ISSUE17..23_TEST_URL` /
> `COLLABORATION_TEST_URL` / `GRAPH_EXECUTION_TEST_URL` / `PRODUCT_ACCEPTANCE_TEST_URL` /
> `COORDINATION_POC_URL` 全部不设），跑完再执行
> `python scripts/check_surefire_skips.py target/surefire-reports backend-unit`。
> 本机实测：`Tests run: 618, Failures: 0, Errors: 0, Skipped: 309`（309 = 302 条隔离库用例 +
> 7 条 MySQL 集成套件用例，按设计全部 skipped），门禁输出 `skip gate passed: no unexpected
> skipped or dropped tests`。
> 另一道门禁 `python scripts/check_surefire_skips.py target/surefire-reports-pass3 graph-execution`
> 输出 `ok: …GraphExecutionTest (37 cases, 0 skipped)`。
> 两道门禁都是**只增不放**：Graph 的期望用例数 36 → 37，门禁要求这 37 条**必须全部跑到**。
>
> **证据出处**：`backend-unit` 那次的 `618 / 309` 与 `skip gate passed` 以**当时保存的运行日志**
> （`r12-ci-unit-job.log`）为准——本轮之后又跑过单条与容器内复跑，`target/surefire-reports` 已被
> 后续运行覆盖，**不再是那次的门禁现场**；`graph-execution` 门禁的现场在
> `target/surefire-reports-pass3/`（未被动过，可重跑复核）。

#### pass 3/3 上一轮的唯一失败：根因、修复与复验

上一轮 pass 3/3 记为 FAIL（`Tests run: 297, Failures: 1`），唯一失败是
`GraphExecutionTest.heartbeatRenewsLeaseAndConcurrentClaimDoesNotDispatchProviders`。
**本轮已定位并修复**。牵涉两条互相独立的因果链，必须分开说：

**第一条（WP-C，确定性产品时钟缺陷，R1.1 已修）**
`recoverPending()` 用 MySQL `CURRENT_TIMESTAMP` 判过期，而 `takeLease()` / `checkLease()` / 续约
用执行器 Java Clock；统一 UTC 只能统一时区，不能统一宿主墙钟。已统一到数据库时钟
（`8cc9f9fe`），并补 `databaseLeaseSurvivesHostClockSkew(-6,+6)` 与「快 20 秒竞争者不得抢活租约」
两条回归——旧实现 2/2 FAIL。详见 [r11-remediation.md](r11-remediation.md)。

**第二条（隔离库夹具，本轮修）**
隔离库夹具用**未池化**的 `DriverManagerDataSource`。协调器 `PatientDraftCoordinator.guarded(...)`
每 20 ms 开一个事务（每个分支线程 + 驱动线程各一份），未池化数据源让**每个事务都新建一条物理
连接**（含 TLS 握手）：

- 实测：一轮 `GraphExecutionTest` 新建约 **2 800** 条物理连接；`CollaborationRunTest` +
  `GraphExecutionTest` 组合 **6 417** 条 / 64 用例 / 181.5 s。
- 连接建立一旦成为瓶颈，租约续约就错过 1 s 的节奏；而用例自己把 `leaseUntil` 手改为
  `NOW()+3s`，3 秒后租约自然过期，`checkLease` 抛 `Stop("STALE_EXECUTOR")`。
- **线程栈实证**（本轮补测，见 [r12-reliability-closure.md](r12-reliability-closure.md) §2.4(d)）：
  在 pre-fix 夹具上抓到的 14 份 jstack 中，有 3 份抓到 `collaboration-coordinator` 线程，
  其中 2 份的栈是
  `DriverManagerDataSource.getConnectionFromDriverManager` → MySQL `negotiateSSLConnection`（TLS 握手）
  → `PatientDraftCoordinator.guarded(:721)` ← `executeGraph(:271)`——
  **协调器确实会卡在物理连接建立里，卡的位置正是续约循环里的租约检查那次 `guarded(...)`**，
  这段窗口内它一条 SQL 都发不出去。
- 修复：三个驱动协调器的隔离库套件（`GraphExecutionTest`、`CollaborationRunTest`、
  `PatientDraftTest`）改用 **HikariCP 池化数据源**，与生产一致（生产 Spring 数据源本就是 HikariCP）。
  **未改任何断言、未删任何用例、未改 PR #68 的运行时实现、未改 V1–V28 迁移。**

| 指标（同一台机器、同一 MySQL 8.0.26、同一命令） | 修复前 | 修复后 |
|---|---|---|
| `GraphExecutionTest` 单类一次运行的物理连接数 | ≈ 2 790 | **52 / 50 / 55**（3 次） |
| `CollaborationRunTest` + `GraphExecutionTest` 组合的物理连接数 | 6 417 | **64 / 64**（2 次） |
| 单类运行耗时 | 101.7 s | **76 / 77 / 81 s**（3 次） |
| 组合运行耗时 | 181.5 s | **90 / 94 s**（2 次） |

> 「修复后」是本轮在集成分支上**重测**的数字（MySQL **全局**状态 `Connections` 前后差值 = 物理连接数；
> 注意 `Com_connect` 是会话级变量，不能用来统计物理连接数）。
> 「修复前」是修复提交 `464b9142` 提交信息里记录的同机同命令实测值——当时的
> `GraphExecutionTest` 是 32 条用例（组合共 64 条）；现在的类已增长到 37 条（组合共 69 条），
> 因此两侧的**用例数不同**，连接数差异不能按每条用例直接相除。本轮在 pre-fix 夹具上的
> 同口径复测见 [r12-reliability-closure.md](r12-reliability-closure.md) §2.4。

#### 本轮新增：把因果链做成确定性回归

`GraphExecutionTest` 新增一条用例
`blockedConnectionAcquisitionSilencesCoordinatorSqlAndExpiresTheLease`（第 37 条，提交 `ae78593f`），
用一个可注入的 `StallingDataSource` 让协调器线程卡在**连接获取**上，然后断言：

1. 阻塞期间该线程**一条 SQL 都没发出**（按线程计数的语句计数器为 0）——即历史现场
   「约 3 秒无任何 SQL」的签名；
2. 租约**没有被续约**，并按**数据库时钟**过期；
3. 执行器被围栏，运行**没有**变成 SUCCEEDED。

停顿是注入的，所以整条链是确定性的，不依赖机器负载，也不放宽任何断言、不延长任何超时。
精确计数门禁 `scripts/check_surefire_skips.py` 的 Graph 用例数同步 **36 → 37**（不是放宽：
该门禁要求这些用例**必须全部跑到**）。

> **一处自我修正（`5d7afd11`）**：这条回归的第一版把语句计数器只代理在 `java.sql.Connection` 的
> `execute/executeQuery/executeUpdate/prepareCall` 上。但 Spring 的 `JdbcTemplate` 是
> **先在连接上 `prepareStatement`、再在语句对象上执行**，那几个钩子从来不会触发——
> 于是「阻塞期间该线程一条 SQL 都没发出」当时是一条**空断言**。现在改为同时代理语句对象，
> 并加了一道自检：**阻塞发生前该线程的计数必须已经大于 0**，否则直接失败。
> 这样「计数没有增长」才只能是「确实没有发出 SQL」。

#### 修复在哪条线上做的，以及复验矩阵

**修复在 PR #68 原线上完成**（分支 `fix/graph-lease-heartbeat-flake`，基点 `10173ae9`，
提交 `464b9142` 池化夹具 + `bf1858fe` 给 `scripts/verify.sh` 补第三遍隔离库门禁），
**验证通过后**才整合回本集成分支（cherry-pick → `0c3d0aec`）。PR #68 的原开发分支
`codex/realtime-product-acceptance` **未被改动**。两条线现在都已进入本集成分支
（`fix/graph-lease-heartbeat-flake` 本身仍未单独推送；其提交经 cherry-pick 进入
`feat/iris21-multiagent-integration`，已随该分支推送）。

| 运行方式（在 PR #68 原线 `464b9142` 上） | 次数 | 结果 |
|---|---|---|
| 只跑该单方法 | 5 | 5/5 PASS |
| 跑整个 `GraphExecutionTest` 类（32 用例） | 3 | 3/3 PASS |
| `CollaborationRunTest` + `GraphExecutionTest`（64 用例） | 2 | 2/2 PASS |
| pass 3 等价（12 个隔离库套件同 JVM，297 用例） | 2 | 2/2 PASS（`Tests run: 297, Failures: 0, Errors: 0, Skipped: 0`） |
| 完整三遍（pass1 558 / 0 失败 / 297 跳过、pass2 7/7、pass3 297/297） | 1 | 全绿 |

#### 本轮集成候选上的复验

| 运行方式（在集成分支上） | 次数 | 结果 |
|---|---|---|
| 完整三遍 · **原生替代**（pass1 / pass2 / pass3） | 1（在 `5d7afd11` 上） | **全绿** — pass1 `Tests run: 611, Failures: 0, Errors: 0, Skipped: 302`；pass2 **7/7**；pass3 `Tests run: 302, Failures: 0, Errors: 0, Skipped: 0`（其中 `GraphExecutionTest` **37/37**，耗时 60.47 s） |
| 完整三遍 · **真实 Docker**（`scripts/verify.sh` 原样） | 1 | **pass1 ✅ 611 / pass2 ✅ 7/7 / pass3 ❌ 302 跑、3 失败**（全部在 `GraphExecutionTest`；归因见 §8.2 与 r12 §3.2） |
| 12 套件同 JVM · **容器内**（JVM 与 MySQL 同时钟域） | 1 | 302 跑 / **1 失败** / 0 error — 3 条时钟用例转绿；1 条有界等待抖动，单条复跑 3/3 通过（近因 UNEXPLAINED） |
| `GraphExecutionTest` 整类（含新增第 37 条因果回归） | 2 | 2/2 PASS（37/37） |
| pass 3 等价 · 原生（12 个隔离库套件同 JVM） | 2 | 2/2 PASS（302/302，其中 Graph 37/37） |

#### 环境干扰（不是产品回归；第 3 条的近因未定性）

1. **pass 1 的 `FullApplicationAcceptanceTest` 登录失败**：宿主 Redis 进程在运行期间退出，
   `RedisSessionRepository.save` 抛 `RedisConnectionFailureException`，Spring Session 落盘失败
   ⇒ 登录接口返回非 0 ⇒ 用例「患者登录应成功」断言为 false。重启 Redis 后复跑通过。
2. **pass 3 的 3 条失败**（`databaseLeaseSurvivesHostClockSkew(-6)`、`(6)`、
   `processDeathRestoresOnlyCommittedNodesAndPreservesBudgets[JOIN:DEADLINE]`）：
   同机另有一个三遍验证进程退出时把 MySQL `time_zone` 还原为 `SYSTEM`，而当前进程 JVM 被
   `-Duser.timezone=UTC` 固定为 UTC。实测真值表（Connector/J 9.4.0）：

   | MySQL 会话时区 | JVM 默认时区 | 实测偏差（宿主 − 数据库） |
   |---|---|---|
   | `+00:00` | UTC | ≈ 0（一致） |
   | `+00:00` | +08:00 | +28 800 000 ms |
   | `SYSTEM`（=+08:00） | UTC | **−28 800 001 ms** ← 与失败现场实测的 −28 806 000 / −28 794 000 ms 吻合 |
   | `SYSTEM` | +08:00 | ≈ 0（一致） |

   串行重跑后 pass 3 全绿。**教训**：`scripts/verify.sh` 第三遍的 `-Duser.timezone=UTC` 与服务端
   `time_zone` 必须成对设置，且同一台机器上不得并发跑两套三遍验证。
3. **真实 Docker 跑的 pass 3 另有 3 条失败**（同样这三条用例，但成因不同）：偏差是
   1–3.5 秒级而不是 8 小时——MySQL 在 WSL2 虚拟机、JVM 在 Windows 宿主，两个时钟域。
   把 JVM 放进容器内复跑，这 3 条全部转绿；同一次运行另暴露 1 条有界等待抖动
   （`heartbeatRenewsLease…`，整类跑失败、单条复跑 3/3 通过，**近因未定位**）。
   详见 r12 §3.2。**未删除测试、未放宽断言、未延长超时。**

#### Hosted CI

本轮已在**用户授权后**推送分支并创建 Draft PR #87（base `ui`），`verify` 工作流跑了两轮：

| 运行 | SHA | 结果 |
|---|---|---|
| #1 `43722307612` | `69233c8d` | **15 ✅ / 5 ❌** |
| #2 `43722586269` | `b5613166` | **20/20 ✅** |
| #3 `43723396362` | `51b42c10` | **19 ✅ / 1 ❌** — `backend-unit`，与 #1 同一个未修复竞态 |

**#1 的 5 个失败分三类**：前两类（`docs-contract` 与 `issue17/18/19-mysql`）已在 `b5613166` 修复，
第三类（`backend-unit`）是**未修复的产品侧竞态**，本轮只披露不修（见下）：

1. **门禁自测停留在旧契约**（`docs-contract`、`issue17/18/19-mysql`）：`scripts/tests/test_check_surefire_skips.py`
   的夹具仍写 `GraphExecutionTest` 32 例，而契约已 32→36（R1.1）→37（R1.2）。
   这是**本轮之前就存在的缺陷**：本机只跑过 `check_surefire_skips.py` 本身、没跑过它自己的单测，
   直到 hosted CI 才暴露。夹具改为 37/36 是**跟随契约**，门禁仍然要求全部 37 例跑到。
2. **steering 契约在集成时丢失**（`docs-contract`）：`check_steering_docs.py` 要求 `CLAUDE.md`
   声明迁移头与全部 controller 路径。本分支沿用了 `ui` 的 `CLAUDE.md`，把 PR #68 线
   （`10173ae9`）里的这段契约丢了（既无 `Current head is V<n>`，`/api/mcp-server` 也仍写成 `/api/mcp`）。
   已补回迁移头、完整 controller 表与关键表清单。

**#1 的 `backend-unit` 失败是一条真实的窄窗口竞态（P2，不是断言过严）**

`FullApplicationAcceptanceTest.collaborationRunProjectsDetailsOnlyToCliniciansAndSurvivesReplay:306`
——患者从创建响应里的 `resumeCursor` 回放，实际收到
`[agent.started, agent.completed, agent.summary, run.review_ready, run.completed]`，**缺 `run.started`**。

机制（读代码可确定，不是推测）：

- `CollaborationRunService.create()` 在事务提交后先 `kick(runId)`（`:110`）**再** `snapshot(runId, userId)`（`:111`）；
- `snapshot()` 在 `:118` 读当前 `seq`，据此在 `:124` 签发游标；
- 回放查询是 `... WHERE runId=? AND seq>? AND seq<=?`（`:147`，**严格大于**）；
- 协调器线程若在 `kick` 与这次读之间写入 `run.started`（seq 2），创建响应返回的游标就是 2，
  客户端从该游标续读**永远看不到** seq 1（`run.accepted`）与 seq 2（`run.started`）。
  失败消息里实际收到的正是 `agent.started` 起的后续事件——与该游标值逐项吻合
  （用例只断言到 `run.started`，所以「其余事件齐全」只就它要求的清单成立）。
- **前端还有同一处的第二个实例**：`web/src/hooks/useCollaborationRun.ts` 的 `follow()` 在
  `:109` / `:117` 重新取快照并用该快照的游标起流（`:131`），水位比创建响应更晚，风险相同。

时序依赖：本机 4 份日志 7/7 通过；**CI 4 次运行失败 2 次**（`69233c8d`、`51b42c10`），
`b5613166` 通过。**判定为产品侧事件丢失，不是断言过严；未删测试、未放宽断言、未重跑掩盖。**
建议修复（本轮**未实施**，产品代码改动留待合并决策）：创建响应的游标钉在创建事务内的
seq（`run.accepted` 之后），再 `kick`。

**#2 的 20/20 说明三件事**

- `graph-execution-mysql`、`collaboration-mysql`、`issue17–24` 全绿：§8.2「环境干扰」里那 3 条
  时钟用例在 CI 的**单一时钟域**上通过，与本机 Docker 跨时钟域的归因一致。
- `flyway-mysql`（正序 / 逆序两个 job）、`web`、`frontend`、`product-contract`、`python`、`watchdog`、
  `backend-compile` 全绿；`backend-unit` 本轮 `Tests run: 618, Failures: 0, Errors: 0, Skipped: 309`。
- 上一轮 PR #68 原线 `codex/realtime-product-acceptance` 在基点 `10173ae9` 上也连续 12 次全绿；
  本分支在 `b5613166` 上达到同一状态。

CI 与本地的配置差别：CI 把每个隔离库套件拆成独立 job（`graph-execution-mysql` 跑
  `GraphExecutionTest,RealtimeGraphSpikeTest,CoordinationPocTest`，`collaboration-mysql`、
  `issue17..23-mysql` 各跑各的），**12 个套件同 JVM 的组合只在 `scripts/verify.sh` 第三遍存在**
  ——而失败恰恰只在这个组合下出现。`scripts/verify.sh` 补上第三遍，等于把这条组合配置纳入门禁。

### 8.3 完整应用级验收

`FullApplicationAcceptanceTest` 7/7 PASS（见 §6）。该测试在 pass 1/3 中随全量套件执行，
也单独在一次性 MySQL+Redis 环境复跑通过。

**一处必须标注的时序敏感**：其中的
`collaborationRunProjectsDetailsOnlyToCliniciansAndSurvivesReplay` 在 hosted CI #1 上失败过
（患者回放缺 `run.started`），本机三次与 CI #2 均通过。失败原因是产品侧
「创建响应游标可能跳过 `run.started`」的窄窗口竞态（§10 第 8 条），**不是**该用例断言过严。
因此本节的 7/7 是**实跑记录**，不代表该用例在任意时序下都稳定。

### 8.4 证据未被人为修饰

- 本会话**没有删除任何测试**、没有放宽任何断言。
- 租约心跳用例的修复**没有碰断言、没有删用例**：只把三个隔离库夹具的
  `DriverManagerDataSource` 换成 HikariCP 池化数据源，并把 `scripts/verify.sh` 补上第三遍
  隔离库门禁（原来那两遍会把隔离库套件整类跳过）。
- 本轮新增的第 37 条因果回归同样是**只增不改**：没有改任何既有断言、没有删任何既有用例、
  没有延长任何超时；精确计数门禁从 36 改成 37 是**要求更多用例必须跑到**，不是放宽。
- **Docker 的实跑结果照实记录**：Docker 在会话中途恢复后，原样的 `scripts/verify.sh` 跑出
  pass 1 ✅ 611 / pass 2 ✅ 7/7 / **pass 3 ❌ 302 跑、3 失败**；本机**没有**全绿，因此**不记 PASS**。
  那 3 条失败的归因（跨时钟域）与控制变量实验见 [r12 §3.2](r12-reliability-closure.md)；
  它们**没有**被隐藏，也**没有**被改写成「Docker 三遍通过」。
- 同一批隔离库套件在原生 MySQL（与 JVM 同一时钟域）上是 302/302，在容器内（JVM 与 MySQL
  同一时钟域）是 302 跑 / 1 失败——两个结果都记录，不取其中好看的那个当结论。
- 失败与重跑日志全部保留；宿主机的 `time_zone` 在替代跑完后已还原为 `SYSTEM`。
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

**P0：本轮未证实新增，但不能推断不存在。P1：同左。**
（口径与 [r11-remediation.md](r11-remediation.md) 一致：七项原 P2 均 CLOSED；
WP-C 历史因果**机制已确立、历史现场本身判定为 UNEXPLAINED**，详见 §8.2 与
[r12-reliability-closure.md](r12-reliability-closure.md) §2。）

P2 / 已知缺口：

1. **租约心跳的整类失败已修复；历史现场的根因判定为 UNEXPLAINED（不是 OPEN 的缺陷）**（§8.2）。
   这条同时牵涉三件事，必须分开说：

   - **已修复（确定性）**：受控时差证明的产品时钟缺陷——`recoverPending()` 用 MySQL
     `CURRENT_TIMESTAMP` 判过期，而 `takeLease()` / `checkLease()` / 续约用执行器 Java Clock。
     已统一到数据库时钟（提交 `8cc9f9fe`），并补了 `databaseLeaseSurvivesHostClockSkew(-6,+6)`
     与「快 20 秒竞争者不得抢活租约」两条回归。旧实现 2/2 FAIL。
   - **已修复（夹具）**：隔离库夹具用未池化 `DriverManagerDataSource`，协调器每 20 ms 的轮询事务
     各自新建一条物理连接，连接建立抖动就拖垮租约续约。已在 PR #68 原线
     （`fix/graph-lease-heartbeat-flake`，`464b9142`）改为 HikariCP 池化数据源并整合回本分支
     （`0c3d0aec`），单方法 ×5、整类 ×3、组合套件 ×2、pass 3 等价整套 ×2 全部通过。
   - **本轮已把机制做成确定性回归**（新增第 37 条
     `blockedConnectionAcquisitionSilencesCoordinatorSqlAndExpiresTheLease`）：
     协调器线程若在**发出语句之前**被连接获取卡住，就会同时产生「该线程无任何 SQL」
     「续约错过节奏」「租约按数据库时钟过期」「执行器被围栏」四个现象——与历史记录逐条吻合。
     停顿是注入的，整条链不依赖机器负载，也不放宽任何断言、不延长任何超时。
   - **机制另有独立实证**（本轮补测）：在 pre-fix 未池化夹具上抓到的 jstack 里，
     `collaboration-coordinator` 线程**确实**卡在 `DriverManagerDataSource.getConnectionFromDriverManager`
     的 TLS 握手里，位置正是续约循环里的租约检查那次 `guarded(...)`（§8.2 与 r12 §2.4(d)）。
     另有排除实验证明**锁等待会照常出现在 general log 里**，因此「日志里一条 SQL 都没有」
     排除锁等待这一类成因（r12 §2.5）。
   - **历史现场本身不可再取证**：最初 Docker 失败现场（约 3 秒无 SQL）的数据库与
     MySQL general log 已被第一次审查删除（仓库内所有 `general_log.CSV` 现均为 0 字节）。
     因此该**具体实例**的根因判定为 **UNEXPLAINED**，**不以推测替代结论**。
     这不是「已确认仍未修的缺陷」，而是**证据边界**。
   - **原定的「在同一 Docker 场景重跑并取 Connect-无-Query 签名」已被证明取不到**（r12 §2.6）：
     Docker 恢复后用受控实验做判别——取 `SELECT CONNECTION_ID()` 得 7515，再用一个「只建 TCP、
     一个字节都不发」的连接保持 3 秒，其间再取得 7517；两次相差 2，探测连接**确实占用了一个连接号**
     （只能是 7516），而 **7516 在 general log 里 0 行**，紧邻的 7515/7517 各有 4 行。
     即 MySQL 只在握手与认证完成后才写 `Connect`，卡在握手里的客户端服务端根本看不见。
     因此历史现场即便开着 general log，也不会留下可检索的行；结论保持
     「机制已确立 + 历史实例 UNEXPLAINED」。
2. **隔离库套件的时区耦合**：该批用例混用 SQL `NOW(6)` 与 JVM `Timestamp` 写入同一列，
   要求 JVM 时区 == MySQL 时区。`scripts/verify.sh` 第三遍已显式对齐 UTC
   （GitHub runner 上两边本来就是 UTC），但这是测试夹具的脆弱点，建议后续让隔离库 URL
   显式带 `serverTimezone` 或统一走 SQL 侧时钟——后者已在 `8cc9f9fe` 对租约列先行落地，
   其余列仍待统一。
3. **`run.restricted` 事件缺完整应用级用例**（§6 表）。代码路径与 `run.failed` 共用，
   隔离库套件覆盖停止语义，但完整应用验收未单独构造 RESTRICTED 输入。
4. **Playwright 浏览器版本**：本机缺 Playwright 期望的 Chromium rev 1254，
   实跑用 rev 1234（Chromium 151.0.7922.34）。截图比对仍 12/12 通过，
   但证据应记录实际版本（本报告即为此）。
5. **两个显式 opt-in 的浏览器用例已在 R1.1 跑通**：`collaboration-backend.spec.ts`、
   `collaboration-safety.spec.ts` 需要 `scripts/run_task05_browser_server.ps1` 起
   `CollaborationBrowserServer`。R1 交付时它们是 `NOT_RUN`；R1.1 改了两份 e2e 的入口与深链
   （改到独立协作工作台、刷新后重新授权取得新 Blob 影像），**没有删业务断言、没有扩大超时**，
   串行 `--workers=1` 跑出 **5/5 PASS**（见 §8.1 与 r11-remediation.md）。
   它们的证据边界是**合成 HTTP/SSE 的 `CollaborationBrowserServer`**，区别于 §6 的完整 Spring Boot；
   §6 以更强形式覆盖了同一批权限与投影断言，二者**互为补充、不互相替代**。
6. **容器内整类顺序执行时有界等待抖动（近因 UNEXPLAINED）**：`heartbeatRenewsLeaseAndConcurrentClaimDoesNotDispatchProviders`
   在「JVM 与 MySQL 同一时钟域」的容器复跑里失败 1 次（10 s 有界等待未满足），
   同一容器、同一 schema 下**单条复跑 3/3 通过**；原生与 Docker 的整类跑也都通过。
   本轮**没有**改断言、没有延长超时、没有跳过用例，按口径只记录事实与「近因未定位」。
   它与 §3.2 的跨时钟域 3 条失败是**两回事**，不要混为一谈。
7. **`SameOriginFilter` 不比对 scheme（纵深防御缺口，MINOR）**：`portSuffix` 把 80/443 归一为空串，
   `Origin: http://host` 与发往 `https://host` 的请求被判为同源；`SameOriginFilterTest` 也没有
   scheme 不匹配用例。`session.cookie.same-site=lax` 加上现代浏览器的 Schemeful Same-Site
   使跨 scheme 的 POST 不携带会话 Cookie，**不构成可利用的 CSRF**；本轮按 MINOR 登记、不改代码
   （改过滤器需要新增用例并重跑门禁）。
8. **创建响应的游标可能跳过 `run.started`（P2，hosted CI 暴露，本轮未修）**：
   `CollaborationRunService.create()` 先 `kick(runId)`（`:110`）再 `snapshot(runId, userId)`（`:111`），
   `snapshot()` 在 `:118` 读 `seq` 签发游标，而回放是 `seq>?` 严格大于（`:147`）。
   协调器若在这两步之间写入 `run.started`（seq 2），创建响应给出的游标即为 2，
   患者从该游标回放**永远收不到** `run.started`。CI #1 的
   `FullApplicationAcceptanceTest…:306` 失败与此逐项吻合；本机三次通过、CI #2 通过。
   **未删测试、未放宽断言**。修复方向：游标钉在创建事务内的 seq 再 `kick`（需改产品代码，留待合并决策）。
9. **`check_steering_docs.py` 的 controller 扫描不递归（门禁缺口，MINOR，本轮不改）**：
   脚本用 `controller/*.java` 非递归 glob，因此 `agent/controller/AgentImageUploadController.java`
   （`/agent/image`）不在扫描范围内；`CLAUDE.md` 的 `/api/agent/*` 一行在语义上覆盖了它，
   所以**没有错误声明**，但「列全所有 controller」并非字面强制。另外它用子串匹配
   （`path not in text`），路径在文档任意位置出现即通过。属**既有**门禁强度问题，
   建议单独开 Issue 收紧（递归扫描 + 按表格行匹配）。
10. `e2e/smoke.spec.ts`（真实后端 + 真实账号 + 算法服务）按设计 SKIP，见 §8。

**R1.2 独立审查结论：`REVIEW_PASS`**（审查对象 `4aaf315d`，只读审查、未跑构建/测试）。
审查员接受了 5 条残余风险（本机 Docker pass 3 未全绿、容器内有界等待抖动近因未定、
历史 WP-C 实例 UNEXPLAINED、`snapshot()` 缺 live-thread 守卫、生产协作仍 BLOCKED），
并提出 5 处文档异议——全部已在本轮逐条修正（详见
[r12 §4.4](r12-reliability-closure.md)）。**审查结论不等于生产启用依据。**

**生产启用门禁（本报告不解除）**

- 生产医疗协作保持 **BLOCKED**：未部署、未在 `ui`/`master` 合并、未开启任何
  `eye-diagnosis.collaboration.*` 开关。
- 启用前至少还需要：真实模型质量与安全性评审、真实数据脱敏与留存策略、
  医生授权流程的合规确认、SSE 容量与重连压测、生产 `cursor-key` 的密钥管理。

---

## 11. 集成本地 HEAD

| 提交 | 内容 |
|---|---|
| `d0f6b59e` / `a970602b` | 两轮可追溯 merge：PR #68 后端、独立 React 多 Agent 工作台 |
| `e75b1055` | 三项 P2（取消竞态 / SSE 错误体 / 未知任务状态降级） |
| `926c62f2` | 完整应用级验收 + 隔离库时区对齐 + 冻结 UI 扫描 |
| `8e630be8` | R1.1 WP-A：工具终态串行化、失效会话推送、协议修复循环 |
| `eb4dd48f` | R1.1 WP-B：Critic 语义、冻结 Vision 白名单、服务端上传引用转换 |
| `8cc9f9fe` / `c2815fcd` | R1.1 WP-C：租约统一数据库时钟 + 时差回归 + 快时钟竞争者负例 |
| `e4e13aad` | R1.1：协作浏览器回归对齐独立入口与授权图片重读 |
| `6eb38afd` / `58955939` | R1.1 整改证据与门禁说明 |
| `0c3d0aec` | 隔离库夹具改用 HikariCP 池化数据源（cherry-pick 自 `464b9142`，PR #68 原线） |
| `ae78593f` | **R1.2**：新增租约续约静默的确定性因果回归（第 37 条）+ 精确用例数门禁 36 → 37 |
| `5d7afd11` | **R1.2**：修正该回归的语句计数器（改为代理语句对象）并加计数自检，避免空断言 |
| `4aaf315d` | **R1.2**：独立审查结论入档（`REVIEW_PASS`，审查对象即此 SHA） |
| `69233c8d` | **R1.2**：审查员 5 处文档异议逐条修正 + `SameOriginFilter` MINOR 登记（仅文档） |
| `b5613166` | **R1.2**：修复 hosted CI——`scripts/tests` 夹具跟随 37 例契约、`CLAUDE.md` 补回 steering 契约 |
| 本文件所在提交 | 交付报告（分支 tip，交付时给出） |

分支：`feat/iris21-multiagent-integration`，基点 `7ec746fb`（`origin/ui`）。
**已推送**（用户明确授权）并创建 Draft PR #87，base = `ui`；**未合并到 `ui`/`master`、未部署。**

配套的 PR #68 原线修复分支：`fix/graph-lease-heartbeat-flake`（基点 `10173ae9`），
`464b9142`（池化夹具修复）+ `bf1858fe`（`scripts/verify.sh` 补第三遍隔离库门禁）。
该分支本身**仍未推送**（其提交已 cherry-pick 进集成分支并随之推送）。

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

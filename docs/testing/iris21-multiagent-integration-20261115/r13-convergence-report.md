# Iris Multi-Agent R1.3 · 分支收敛与交付核对报告

- 执行时间：2026-11-16
- 执行角色：R1.3 收敛负责人（只做 Git 收敛、增量核验、报告整理；不新增多 Agent 功能）
- 终态：**CONVERGED**（快进收敛；源码树与夜间验收树逐字节相同）
- 生产医疗协作：**BLOCKED**（合并 ≠ 启用）

---

## 一、Git 历史核对

全部结论由命令得出，不按提交数量推断。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Codex 与夜间是否祖先关系 | `git merge-base --is-ancestor d66e6e22 7abfe50c` | **exit 0，Codex 是祖先** |
| 反向 | `git merge-base --is-ancestor 7abfe50c d66e6e22` | exit 1，非互相包含 |
| 夜间分支是否完整包含 Codex | `git log d66e6e22..7abfe50c` | 3 个提交，均为夜间新增 |
| 收敛前集成分支本地 HEAD | `git rev-parse feat/iris21-multiagent-integration` | `d66e6e22` |
| 与远端集成分支的关系 | `git rev-list --left-right --count origin/…...feat/…` | `0 2`（本地领先 2，远端无独有提交） |
| `origin/ui` 与本地 `ui` | `git rev-parse origin/ui ui` | 同为 `b5f37e5c` |
| 冻结 tag | `git rev-parse iris-ui-v2.1-freeze-20261115^{commit}` | `80f53f7f`，未移动 |
| 相关三个工作树 | `git status --porcelain` | 全部干净 |

夜间相对 Codex 新增的 3 个提交：

```
7abfe50c docs(testing): 校正夜间报告执行时间
c94354b8 docs(testing): R1.3 夜间接力验收报告
ffb6ff4b fix(web): 夜间集成整改——冒烟入口、种子严重度与工具状态语义色
```

集成分支相对夜间**没有**独有提交（`git rev-list --count 7abfe50c..feat/iris21-multiagent-integration` = 0），
因此两条交付不存在分叉，无需比较补丁、无需重复 cherry-pick。

## 二、收敛方式与最终 SHA

在集成工作树（`feat/iris21-multiagent-integration`，收敛前干净位于 `d66e6e22`）执行：

```
git merge --ff-only feat/iris21-multiagent-r13-nightly
```

结果：`d66e6e22..7abfe50c  Fast-forward`，6 个文件（+190/−5），无合并提交、无重写历史、
无重复提交。Codex 的两个本地未推送提交（`d8bc8f84`、`d66e6e22`）原样保留。

| 项 | 值 |
| --- | --- |
| **最终集成分支 SHA** | `7abfe50c50bf23ab7b6904e9e9c56f20e8e004bb` |
| 最终树 | `20f8c4244b819fbb54eb3525c9b03260aed378ad` |
| 已验收树（夜间终态） | `20f8c4244b819fbb54eb3525c9b03260aed378ad`（**相同**） |
| 夜间分支 | 同 SHA `7abfe50c`（与集成分支同树） |
| 收敛后工作树 | 干净 |

本报告本身是 `7abfe50c` 之上的 **docs-only** 提交：`git diff --name-status 7abfe50c HEAD`
只有本文件，源码、测试、迁移与配置与已验收树逐字节相同。分支最终 SHA 以交付消息为准。

## 三、UI 冻结对比

冻结基线 = `iris-ui-v2.1-freeze-20261115` → `80f53f7f`。

| 文件 | 冻结 tag blob | 最终分支 blob | 结论 |
| --- | --- | --- | --- |
| `web/src/pages/AgentPage.tsx` | `df36b2de…` | `df36b2de…` | 相同 |
| `web/src/styles/tokens.css` | `d5de71e4…` | `d5de71e4…` | 相同 |
| `web/src/pages/LandingPage.tsx` | `d735107e…` | 同左 | 相同 |
| `web/src/pages/LoginPage.tsx` | `10834586…` | 同左 | 相同 |
| `web/src/pages/RegisterPage.tsx` | `762c8472…` | 同左 | 相同 |
| `web/src/pages/NewsPage.tsx` | `625ff58c…` | 同左 | 相同 |
| `web/src/pages/NewsDetailPage.tsx` | `48fdbe27…` | 同左 | 相同 |
| `web/src/components/RecordSheet.tsx` | `3b7f6fae…` | 同左 | 相同 |
| `web/src/pages/admin/**`、`web/src/components/admin/**`（39 个文件） | — | — | `git diff --name-status 80f53f7f 7abfe50c` 为空 |

**PR #86 未被回退**：`.github/workflows/verify.yml` 仍执行 `npm run check:e2e-fixme` 与
`npm run check:gate-tests`；`web/e2e/fixme-budget.json`、`web/scripts/e2e/check-fixme.mjs`、
`web/scripts/evidence/check-report.mjs`、`web/scripts/gate-checks.node.mjs` 与 #86 合并后的
内容一致（本次核对未发现它们出现在回退 diff 中）。

**Issue #81**：`web/e2e/fixme-budget.json` 为 `max: 0`、`entries: []`；`web/e2e/` 内已无
`test.fixme`；`check:e2e-fixme` 实测输出 `e2e fixme: 0/0 / OK`，预算登记与代码一致。
`smoke.spec.ts` 中唯一的跳过是缺凭证守卫（`test.skip(!hasAccount, …)`），不是用例隔离。

## 四、三项成果核验

### A. SSE 创建游标

代码核验（`CollaborationRunService.java:71-113`）：

- `snapshot()` 在**受理事务内**、仍持有 run 行排他锁时取值（`TransactionTemplate` 默认
  `REQUIRED`，加入同一事务），`run.accepted` 已把 `seq` 推到 1，返回的
  `snapshotSequence` / `resumeCursor` 即提交水位。
- `kick()` 在 `transactions.execute` 返回（提交）之后调用；`recoverPending()` 在提交前看不到该行。
- `subscribe()` 从水位 1 订阅，回放断言包含 `run.started`（`CollaborationRunTest` 新增用例，
  用 `afterCommit` + `CountDownLatch` 强制恢复抢跑，无 sleep；旧实现会在
  `assertEquals(1, snapshotSequence)` / `assertEquals("ACCEPTED", …)` 处失败）。
- 前端 `useCollaborationRun.ts`：`admitted` 只在 `!forceRefresh && !view.run` 时使用一次，
  随后 `admitted = undefined`；StrictMode 第二次 effect 因 `view.run` 非空不再 GET；
  `retry()`/`cancel()` 走 `connect(true)` 强制重新取快照；`collaborationReducer.ts:40`
  丢弃 `sequence <= state.sequence` 的重复帧。
- 身份切换由 `CollaborationPage` 的 `key={identityKey}` 整体重挂载，`admission` 不跨账号复用。

结论：不丢 `run.started`，重连不重复受理。

### B. Issue #81 三条冒烟

- 资讯：真实 `POST /api/news/list/page/vo` → 点击真实标题链接 → 真实
  `GET /api/news/get/{id}`，核对 id、h1、非空 `.news-paper__body`。
- 记录：真实 `POST /api/diagnosis/list/page/my`；空态核对文案与 `.records__row` 数量为 0，
  有数据时走真实列表 id → 详情 id → `.sheet` / `.sheet__head` / `.sheet__verdict`。
- 普通 Agent：显式本地 SSE 夹具 + `generate-title` 桩，断言固定回复、发送内容、发送按钮恢复。
- 种子 `fixtures/smoke-news.sql`、`fixtures/smoke-record.sql` 均限定
  `DATABASE()='diagnosis_ci'` + `BINARY userAccount=BINARY @smokeAccount` +
  `userAccount LIKE 'irisSmokeFixture%'`，INSERT-only、固定主键，不更新/删除既有数据。

结果口径：

| 路径 | 结果 | 来源 |
| --- | --- | --- |
| 真实 API 四条的其余三条 + 空记录 | **4/4 PASS** | 夜间执行（树相同，复用） |
| 种子记录后的记录纸 | **1/1 PASS**（severity 整改后复跑） | 夜间执行（树相同，复用） |
| 缺凭证 | **4 skipped** | 本轮实测重跑，仍为 4 skipped |

`skip` 不计为通过。

### C. 夜间整改三项

| 改动 | 核验 |
| --- | --- |
| `package.json` 增 `test:smoke`、README 改用该入口 | 入口存在；本轮以 `npx playwright test e2e/smoke.spec.ts` 实测 4 skipped |
| `smoke-record.sql` severity `MODERATE` → `moderate` | 文件已为小写 `moderate`，与前端 `severityLabel` 词表一致 |
| `.gitignore` 增 `test-results-*/` | 已存在 |
| `agent.css` 工具状态色改用 `--brand-cyan` / `--brand-primary` / `--danger` | 三个令牌均在冻结 `tokens.css` 中定义；`agent.css` 其余 `--risk-critical` 仅用于医学严重度（780/781/890 行），语义分离反而加强 |

三个提交合计 6 个文件（5 个源码/配置 + 1 个报告），未触及 `src/main`、`src/test`、
迁移 V1–V28、生产开关与冻结 UI 文件。

## 五、本轮实际执行的验证

同一棵树上执行（`20f8c424…`）：

| 验证 | 结果 |
| --- | --- |
| `npx tsc -b` | **PASS**（exit 0） |
| `npx vitest run` | **PASS 637/637，66 文件，0 跳过** |
| `npm run check:e2e-fixme` | **PASS 0/0** |
| `npm run check:gate-tests` | **PASS 6/6** |
| `npx playwright test e2e/smoke.spec.ts`（无凭证） | **4 skipped**（如实记录） |

复用的夜间证据（源码树与验收树为同一 tree `20f8c424…`，故不重复执行）：

- 协作 Playwright 29/29、默认关闭 1/1、冒烟空记录 4/4、种子记录 1/1；
- `scripts/verify.sh` 第 3 次：612（0 失败 / 303 opt-in skip）/ 7 / 303，`==> verify green`；
- `FullApplicationAcceptanceTest` 7/7、`GraphExecutionTest` 37/37、`CollaborationRunTest` 33/33。

未执行项（明确记为 NOT_RUN）：

- 本轮未重跑后端 Maven 套件（快进且树相同，按交接允许复用）；
- 最终 SHA 的 Hosted CI：**NOT_RUN**（未推送）；
- 真实模型提供方 / 真实患者数据 / 临床评估：**NOT_RUN**。

远端 `01098ccb` 的历史 CI（20/20）仅作转述，不作为本地最终 SHA 的证据。

## 六、仍存在的 MINOR

沿用夜间审查登记，本轮未新增修复：

1. `ToolRequestMessage` 工具状态芯片对普通聊天全局生效，非 flag 门控——待产品决定。
2. fixme 门禁不识别 `test.skip(true)` / `describe.skip`（当前树内无此类用法）。
3. 记录空态 / 有记录是同一数据依赖测试的两个分支，流程写在 README，未自动化。
4. `admission` 消费后未清空（fail-safe，当前无触发路径）。
5. 受理事务持锁范围略增（同 owner 受理本就串行）。
6. `docs/collaboration-runs.md` 未写明 POST `snapshotSequence` / `resumeCursor` 即客户端订阅水位。
7. `ui-freeze-regression.spec.ts` 是粗门禁，未接 CI。
8. `SameOriginFilter` 不比较 scheme（既有问题，未改白名单）。
9. 历史 `WP-C` 仍为 UNEXPLAINED。

文档补充说明：夜间报告 §八 建议"cherry-pick `ffb6ff4b` 到集成分支"，本轮实际采用
**快进**，效果等价且不留重复提交；夜间报告本身未改动，以本报告为准。

## 七、与 PR #87 远端 HEAD 的差异

| 项 | 值 |
| --- | --- |
| PR #87 状态 | OPEN，draft，base `ui`，head `feat/iris21-multiagent-integration` |
| 远端 HEAD | `01098ccb8d89afa464904489b6d2b1c268d56e83` |
| 本地最终 SHA | `7abfe50c50bf23ab7b6904e9e9c56f20e8e004bb` |
| 关系 | 领先 5、落后 0（**推送是快进**） |
| 差异规模 | 9 文件，+313/−75（2 个 Codex 提交 + 3 个夜间提交） |
| 内容 | 冒烟真实 API 化、种子 SQL、夜间报告、`test:smoke` 入口、工具状态语义色、`.gitignore` |

PR 正文仍是旧 R1.2 文案，未改动（需授权后再更新）。

## 八、推送条件

- 推送 `7abfe50c` 到 `feat/iris21-multiagent-integration` 是**快进**，不需要 force。
- `verify.yml` 的 `on: pull_request` 未按分支过滤，推送后同步事件会触发全部 Hosted CI 作业。
- 因此**具备进入 Hosted CI 的条件**；但按本轮约束，**未推送**，CI 结果仍为 NOT_RUN。

## 九、边界

- 未推送、未修改远端 PR、未合并到 `ui` / `master`、未部署。
- 未改动 `ui`、`master`、PR #68 分支、冻结 tag。
- 未开启生产协作开关，未使用真实患者数据或真实模型提供方。
- 生产医疗协作保持 **BLOCKED**。

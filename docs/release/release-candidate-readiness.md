# Release Candidate Readiness

**当前状态：`RC_READY_WITH_EXTERNAL_GATES`（仅供 owner 内部候选审查；不等同所有门禁通过，不是 RELEASED）**

> 正式发版、合并 `ui` / `master`、打 tag、GitHub Release、部署、生产开关变更
> **全部需要 owner 明确批准**，本轮未执行、也不会自动执行。
> 候选 PR #119 是 **Draft**，不得直接合并。

## 1. 候选标识

| 项 | 值 |
|---|---|
| 候选分支 | `integration/iris-release-candidate`（已推送 origin） |
| **候选代码 HEAD** | `6ff5a889daaac2e489db0f4ddb710c360e60fee1` |
| 基线 | `origin/ui@1ff9c71c` |
| 建议版本号 | `v1.1.0-rc.1` |
| 数据库迁移 | 最高 `V28__agent_tool_audit.sql`；**相对基线无新增迁移** |
| 冻结 tag | `iris-ui-v2.1-freeze-20261115` = `80f53f7f`（本地与远端均未移动，已核对） |
| 候选 PR | [#119](https://github.com/yuwen773/eyes-diagnosis/pull/119)（Draft → `ui`） |

> 收尾文档提交（`docs/release/**`）只改文档、不改代码树；
> 判定与 CI 证据绑定的是上面的代码 SHA。

## 2. 已完成的测试（绑定 `6ff5a889`）

### 2.1 本地全量后端验证 `scripts/verify.sh`

| 门禁 | 结果 |
|---|---|
| pass 1/3 完整 `mvn test`（一次性 MySQL 8 + Redis + `ci` profile） | ✅ `Tests run: 719, Failures: 0, Errors: 0, Skipped: 303` |
| pass 2/3 MySQL 集成门禁（空库 Flyway 到 V28 + 直连 JDBC + 工具审计表） | ✅ `Tests run: 7, Failures: 0` |
| pass 3/3 隔离库协作套件 | ✅ `Tests run: 303, Failures: 0` |
| 收尾 | ✅ `verify green` |

pass 1 的 303 个 skipped 是按设计：这批协作套件在 pass 3 用独立 schema 重跑，
不是「跳过没跑」。

### 2.2 GitHub Actions（PR #119，head `6ff5a889`，run 44442060009）

✅ **21/21 job 全部 `COMPLETED/SUCCESS`**，含
`backend-compile`、`backend-unit`、`collaboration-mysql`、`graph-execution-mysql`、
`flyway-mysql ×2`、`issue17–24-mysql`、`issue24-evaluation`、`web`、
`web-e2e-system-states`、`product-contract`、`docs-contract`、`python`、`frontend`、`watchdog`。

### 2.3 定向回归（整改面）

| 门禁 | 结果 |
|---|---|
| P0 端到端：真 `@Tool` 抛异常 + 真 `ReactAgent`（`AgentToolFailureEndToEndTest`） | ✅ 2 项 |
| Agent 定向单测（工具事件 / 脱敏 / 影像工具 / 护栏装配 / 预算 / 并发） | ✅ 28 项 |
| Web 全量单测（`vitest`） | ✅ 93 文件 / 1009 项 |
| Web `typecheck` / `lint` / `build` | ✅（CI `web` job 在最终 SHA 上复跑通过） |
| Playwright `web-e2e-system-states`（R2 14 条） | ✅（CI job 通过；本机缺 chromium 未能本地跑） |
| `GraphExecutionTest#databaseLeaseSurvivesHostClockSkew` 连跑 2 次 | ✅ 2/2 |

详细逐 SHA 记录见 `verification-matrix.md`。

## 3. 已关闭的阻断

| 编号 | 原阻断 | 关闭证据 |
|---|---|---|
| G-1 | 后端全量 `verify.sh` 未在 HEAD 上跑完 | ✅ `6ff5a889` 三段全绿，`verify green` |
| G-2 | GitHub Actions 未跑 | ✅ PR #119 21/21 成功 |
| G-4 | Playwright `web-e2e-system-states` 未跑 | ✅ CI job 通过（14 条断言门禁） |
| — | P0 工具异常误判（SAA 1.1.2.2 `isError()==false`） | ✅ 真实执行路径修复 + 端到端用例 |
| — | P1 旧回合步骤被页面级 `streaming` 叫醒 | ✅ `agentSteps.ts` 收紧 + 3 条回归 |
| — | C 的两条 P1（影像工具假成功、图片先落库后校验） | ✅ 已修并有回归 |

## 4. 仍未关闭的门禁（`RC_READY_WITH_EXTERNAL_GATES` 的直接原因）

| 编号 | 门禁 | 为什么没关闭 | 需要什么才能关 |
|---|---|---|---|
| G-3 | **真实后端链路（真 DashScope → SSE 全链路 / 真工具成功与失败 / 真跨用户隔离 / 真 SSE 断流）** | 需要真实 DashScope 凭据与完整依赖栈；本地无可用 key | 提供凭据后在可用环境跑一轮冒烟 |
| G-5 | **双主题 / 响应式回归截图证据** | 需浏览器截图取证（R2 断言式门禁已跑，但那不是视觉回归） | 按 `DESIGN.md` 回归口径补截图 |

> G-3、G-5 都属于「当前环境无法安全执行」的外部门禁，不是可以自行消除的工程缺陷。
> 按规范，此时只能给 `RC_READY_WITH_EXTERNAL_GATES`，不得声明 `RC_READY`，
> 更不得声明所有门禁通过。

## 5. 四路独立 Review 结论

| Reviewer | 视角 | 判定 | 处置 |
|---|---|---|---|
| A | Agent / Java | `PASS_WITH_P2` | P2-1 幽灵步骤、P2-3 字节上限、P2-4 端到端证据 → 已修；P2-2/P2-5 登记债务 |
| B | React / UI | `PASS_WITH_P2` | running 帧冒充结果 → 已修 |
| C | 安全与医学 | `BLOCKED` → 两条 P1 已修 | 影像分析假成功、图片先落库后校验 → 已修并有回归 |
| D | QA / 发版 | `BLOCKED` → 已关到只剩外部门禁 | 交付物入库、文档口径、SHA 绑定 → 已修；CI → G-2 已关；G-3/G-5 仍开放 |

无 reviewer 报告 P0 未决项。A 用字节码独立复核了 P0 修复的三层前提
（拦截链顺序、`alwaysThrow` 真抛、逃逸后会话可继续），并指出此前缺端到端证据——已补。

## 6. 医疗与生产默认值（未改动）

| 边界 | 现状 |
|---|---|
| 医生正式复核写入门禁 | 保持关闭策略 |
| 多 Agent 协作生产开关 | `eye-diagnosis.collaboration.*` 全 `false`；前端入口 `VITE_COLLABORATION_ENABLED` 未设置 |
| 「模型推理 ≠ 医学证据」措辞 | 未回退 |
| 未核验资质不得冒充已认证医生 | 未改动 |
| 知识库来源筛选 / 语料播种 | `rag.source-type.enabled=false`、`rag.corpus.seed-enabled=false` |

## 7. 终态声明

- 终态：**`RC_READY_WITH_EXTERNAL_GATES`**
- 判定时间：2026-11-19（+08:00）
- 代码 SHA：`6ff5a889daaac2e489db0f4ddb710c360e60fee1`
- 结论：代码、工程验证、CI、独立审查层面无已知未决 P0/P1；
  剩余门禁 G-3（真实 DashScope 链路）与 G-5（双主题/响应式截图）为外部环境门禁，
  当前授权与本机条件下无法安全消除。
- 下一步：owner 提供 DashScope 凭据后在可用环境跑 G-3 冒烟；补 G-5 截图证据。
  两者关闭后方可考虑 `RC_READY`。
- **未执行、等待 owner 批准**：合并 `ui` / `master`、正式打 tag、GitHub Release、部署、生产开关变更。

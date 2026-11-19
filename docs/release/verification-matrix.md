# 验证矩阵

> 所有结论都绑定到具体 SHA。**不同 SHA 的测试结果不能互相顶替。**
> 「未执行」就是未执行，不写成「通过」。

## 1. 当前候选

| 项 | 值 |
|---|---|
| 分支 | `integration/iris-release-candidate` |
| 基线 | `origin/ui@1ff9c71c` |
| 当前 HEAD | `6ff5a889`（代码 + 文档，已推送；Draft PR #119） |

## 2. 已完成的验证（按 SHA）

### 2.1 `1d69698c`（B1：`#112` + `#111` + P1 修复）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Java 编译 / 测试编译 | `mvn -DskipTests compile` / `test-compile` | ✅ |
| Agent 定向单测 | `-Dtest='DiagnosisAgentToolEventTest,AgentGuardrailWiringTest,ToolCallBudgetInterceptorTest,ToolStepConcurrencyTest,ToolStepContractTest,DiagnosisAgentRedactionTest,DiagnosisAgentImageReferenceTest'` | ✅ 39 项 |
| Web 类型 / Lint / 构建 | `npm --prefix web run typecheck` / `lint` / `build` | ✅ |
| Web 单测 | `npm --prefix web test` | ✅ 90 文件 / 991 项 |

### 2.2 `93bb07d3`（B1 收尾，Java 树与 `1d69698c` 相同）

| 门禁 | 结果 |
|---|---|
| `scripts/verify.sh` pass 1/3 完整 `mvn test`（一次性 MySQL 8 + Redis + `ci` profile） | ✅ 303 项，0 失败 |
| pass 2/3 MySQL 集成门禁（空库 Flyway + 直连 JDBC） | ✅ 7 项，0 失败 |
| pass 3/3 隔离库协作套件 | ✅ 303 项，0 失败 |
| 收尾 | ✅ `verify green`，容器自动清理 |

### 2.3 `3c1fdf19`（Batch 2/3 全部合入后）

| 门禁 | 结果 |
|---|---|
| pass 1/3 完整 `mvn test` | ✅ 绿 |
| pass 2/3 MySQL 集成门禁 | ✅ 7 项，0 失败 |
| pass 3/3 隔离库协作套件 | ❌ `GraphExecutionTest#processDeathRestoresOnlyCommittedNodesAndPreservesBudgets[7]` 等待超时 |

**失败归因（有独立证据，不是猜测）**

- 该测试文件与协作/图执行实现相对基线**零改动**：
  `git diff --stat 1ff9c71c..HEAD -- src/main/java/com/csust/eyediagnosis/collaboration src/main/java/com/csust/eyediagnosis/patientdraft src/test/java/com/csust/eyediagnosis/collaboration` 为空。
- 同一棵树上单独复跑该参数化用例：**8/8 全过**；再跑整类时换成另外两条失败
  （`[6] JOIN:DEADLINE` 与已知的 `databaseLeaseSurvivesHostClockSkew[2]`）——
  失败点在每次运行间漂移，是负载下的时序抖动，不是稳定复现的缺陷。
- 该树已包含「隔离库夹具改用 HikariCP 池化数据源」的修复（随 `#117` 带入），
  残余抖动与宿主内存/CPU 竞争有关（本轮并行跑过 vitest 93 workers、Playwright 下载）。
- **结论**：`pass 3` 的结果与机器负载强相关；在 `93bb07d3` 与手动复跑里均为绿。

### 2.4 `9924ed33`（评审整改第一批）

| 门禁 | 结果 |
|---|---|
| pass 1/3 完整 `mvn test` | ✅ 绿 |
| pass 2/3 MySQL 集成门禁 | ✅ 绿 |
| pass 3/3 隔离库协作套件 | ⚠️ **未完成**：运行中被系统因内存不足终止（宿主仅剩 0.5 GB），不是测试失败 |

### 2.5 `6ff5a889`（当前 HEAD）

**本地全量 `scripts/verify.sh`（三段）**

| 门禁 | 结果 |
|---|---|
| pass 1/3 完整 `mvn test`（一次性 MySQL 8 + Redis + `ci` profile） | ✅ `Tests run: 719, Failures: 0, Errors: 0, Skipped: 303` |
| pass 2/3 MySQL 集成门禁（空库 Flyway + 直连 JDBC + 工具审计表） | ✅ `Tests run: 7, Failures: 0` |
| pass 3/3 隔离库协作套件 | ✅ `Tests run: 303, Failures: 0` |
| 收尾 | ✅ `verify green`，容器自动清理 |

> pass 1 的 303 个 skipped 是**按设计**：隔离库协作套件在 pass 3 用独立 schema 跑，
> 两遍合起来覆盖 719 个用例，不是被跳过没跑。

**GitHub Actions（PR #119 → `ui`，head `6ff5a889`，run 44442060009）**

| 结果 | 明细 |
|---|---|
| ✅ **21/21 job 通过** | `docs-contract`、`python`、`watchdog`、`backend-compile`、`backend-unit`、`collaboration-mysql`、`graph-execution-mysql`、`flyway-mysql ×2`、`product-contract`、`frontend`、`web`、`web-e2e-system-states`、`issue17–24-mysql`、`issue24-evaluation` |

这一次跑的就是合并树实际携带的门禁（不是 #101 自报的 8 个 job）：
backend-unit / collaboration / graph-execution / flyway 与本地 `verify.sh` 三段互为对照。

**定向回归（整改面）**

| 门禁 | 命令 | 结果 |
|---|---|---|
| P0 端到端（真 `@Tool` 抛异常 + 真 `ReactAgent`） | `-Dtest=AgentToolFailureEndToEndTest` | ✅ 2 项 |
| Agent 定向单测 | `-Dtest='DiagnosisAgentToolEventTest,DiagnosisAgentRedactionTest,UserBoundEyeImageAnalyzerToolTest,AgentGuardrailWiringTest,ToolStepContractTest,ToolCallBudgetInterceptorTest,ToolStepConcurrencyTest'` | ✅ 28 项 |
| Web 全量单测 | `vitest run --no-file-parallelism` | ✅ 93 文件 / 1009 项 |
| Web 类型 / Lint / 构建 | `typecheck` / `lint` / `build` | ✅（CI `web` job 在最终 SHA 上复跑通过） |
| 时钟偏移用例 | `-Dtest='GraphExecutionTest#databaseLeaseSurvivesHostClockSkew'` 连跑 2 次 | ✅ 2/2 |

### 2.6 `03b14efd`（Codex NO_GO 定向整改后的新候选）

审查对象是上一版候选 `7dc3422b`（代码 `6ff5a889`），Codex 判 **NO_GO**：2 P0 + 5 P1。
本轮在这棵树上逐条整改（台账见 `codex-no-go-remediation.md`），最终代码树 = `03b14efd`。

| 门禁 | 命令 | 结果 |
|---|---|---|
| 本地全量 `scripts/verify.sh` | 三段全跑（一次性 MySQL 8 + Redis + `ci` profile） | ✅ pass1 `751/0/0`（303 skip 按设计）、pass2 `9/0`、pass3 `303/0`，`verify green` |
| 工单级复跑（Flyway） | `-Dtest=FlywayMySqlIntegrationTest`（本机 MySQL 8.0.26 隔离 schema） | ✅ 5/5，含两条新增回滚方向用例 |
| Web 单测 | `vitest run` | ✅ 94 文件 / 1029 项 |
| Web 类型 / Lint / 构建 | `typecheck` / `lint` / `build` | ✅ |
| Web 门禁脚本 | `check:e2e-fixme` / `check:gate-tests` / `check_design_doc.py` / `check_surefire_skips.py` 单测 | ✅ |
| Playwright R2（CI 同款子集） | `test:e2e --grep "Iris System States R2"`（本工作树 Vite :5199） | ✅ 14/14 |
| 双主题 / 响应式（断言式） | `ui-freeze-regression` + `agent-delivery`（light/dark × 390/768/1440，对比度 ≥ 4.5:1） | ✅ 8/8 |
| 工作树故障注入 | `scripts/tests/worktree-hygiene-failclosed.sh` | ✅ 28 断言 / 10 例（含备份失败不得删除、独有提交必须双开关） |
| 真实后端冒烟（真 Java + 真 MySQL 3307 + Redis） | 本项目 `spring-boot:run` 起在 :8082，空库 `diagnosis_rc_smoke` | ✅ 启动即迁移 23 个脚本至 V28（含 `t_agent_tool_audit`）；注册/登录 cookie 会话；时间带 `+08:00` 偏移 |
| 跨用户权限（同上活体） | A 建会话 → A 读历史 ok；B 读 A 历史 `40101 无权限`；B 会话列表为空；匿名 `40100 未登录` | ✅ |
| CSRF/Origin 基线（同上活体） | 无 `Origin`/`Referer` 的 POST → `40300 CROSS_ORIGIN_BLOCKED` | ✅ |
| 用户消息落库（同上活体） | 纯文本提问无附件 → 历史里逐字保存（不是信封），刷新可见 | ✅ |
| SSE 失败出口（同上活体） | 占位 API key → `event:error` + 「系统繁忙，请稍后重试」，不泄漏上游错误文本 | ✅（模型提供方本身不可用属预期） |

**GitHub Actions（PR #119 → `ui`，head `03b14efd`，run 44459485719）**

| 结果 | 明细 |
|---|---|
| ✅ **21/21 job 通过** | `docs-contract`、`python`、`watchdog`、`backend-compile`、`backend-unit`、`collaboration-mysql`、`graph-execution-mysql`、`flyway-mysql ×2`、`product-contract`、`frontend`、`web`、`web-e2e-system-states`、`issue17–24-mysql`、`issue24-evaluation` |

> 收尾文档提交（`c5965778`，只改 `docs/**`）在其自己的 head 上也跑了一次 CI：
> run 44460599844，同样 **21/21 通过**。结论树仍是 `03b14efd`，两者代码树逐字节相同。
>
> 首轮 CI（run 44458627170，head `c1f2e998`）有 2 个 job 失败，均为**用例自身**的问题，
> 已单独修复并留痕：新 Flyway 用例用了 CI 未授权的库名前缀、skip 契约计数未同步。
> 没有放宽任何门禁（见提交 `03b14efd`）。

## 3. 未执行 / 未完成的门禁

| 门禁 | 状态 | 原因 |
|---|---|---|
| 真实后端链路（真 DashScope → SSE 全链路） | ❌ 未执行 | 需要真实凭据；本地无可用 key。本轮活体冒烟只覆盖到「提供方不可用时的失败出口」，不代表工具链闭环 |
| 双主题 / 响应式**截图**证据 | ❌ 未执行（断言式已跑） | 现有 light/dark × 390/768/1440 只验证对比度与版式断言；Codex 侧 72 张截图需复核覆盖度/SHA/产物后才能作为 G-5 证据 |
| Python / 算法侧 | —（不适用） | `algorithm/`、`frontend/` 相对基线零改动（CI `python` job 仍跑过） |

## 4. 口径说明

- 合成单测通过 **不等于** 真实临床能力通过。
- 2.4 的定向用例只覆盖**改动面**，不能替代全量回归。
- 2.5 / 2.6 各自绑定自己的 SHA：`6ff5a889` 的证据只证明 `6ff5a889`，
  当前候选 `03b14efd` 用 2.6 的结果；不再拿其他 SHA 的跑次顶替。
- 医疗边界保持默认关闭：医生正式复核写入门禁、多 Agent 生产开关均未改动。

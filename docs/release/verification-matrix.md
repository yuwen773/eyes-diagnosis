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

## 3. 未执行 / 未完成的门禁

| 门禁 | 状态 | 原因 |
|---|---|---|
| 真实后端链路（真 DashScope → SSE 全链路） | ❌ 未执行 | 需要真实凭据；本地无可用 key |
| 双主题 / 响应式回归截图 | ❌ 未执行 | 需浏览器截图证据（仅 R2 14 条断言式门禁已跑） |
| Python / 算法侧 | —（不适用） | `algorithm/`、`frontend/` 相对基线零改动（CI `python` job 仍跑过） |

## 4. 口径说明

- 合成单测通过 **不等于** 真实临床能力通过。
- 2.4 的定向用例只覆盖**改动面**，不能替代全量回归。
- 2.5 已是当前 HEAD 的**全量**结果（本地 `verify.sh` 三段 + CI 21/21），
  不再拿其他 SHA 的跑次顶替，也不用旧 SHA 的结果证明新 HEAD。
- 医疗边界保持默认关闭：医生正式复核写入门禁、多 Agent 生产开关均未改动。

# 验证矩阵

> 所有结论都绑定到具体 SHA。**不同 SHA 的测试结果不能互相顶替。**

## 1. 当前候选

| 项 | 值 |
|---|---|
| 分支 | `integration/iris-release-candidate` |
| 基线 | `origin/ui@1ff9c71c` |
| 本轮已提交 | `eaa8f409`（#112）、`995097fc`（#111）、`1d69698c`（P1） |

## 2. 已验证（按 SHA）

### `1d69698c`（含 `995097fc`、`eaa8f409`）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Java 编译 | `mvn -DskipTests compile` | ✅ |
| Java 测试编译 | `mvn -DskipTests test-compile` | ✅ |
| Agent 单测 | `mvn -Dtest='DiagnosisAgentToolEventTest,AgentGuardrailWiringTest,ToolCallBudgetInterceptorTest,ToolStepConcurrencyTest,ToolStepContractTest,DiagnosisAgentRedactionTest,DiagnosisAgentImageReferenceTest' test` | ✅ 39 项 |
| Web 类型 | `npm --prefix web run typecheck` | ✅ |
| Web Lint | `npm --prefix web run lint` | ✅ |
| Web 构建 | `npm --prefix web run build` | ✅ |
| Web 单测 | `npm --prefix web test` | ✅ 90 文件 / 991 项 |

### 后端全量（`scripts/verify.sh`，实际树 = `93bb07d3`，Java 树与 `1d69698c` 相同）

| 项 | 结果 |
|---|---|
| pass 1/3 完整 `mvn test`（一次性 MySQL 8 + Redis + `ci` profile） | ✅ 303 项，0 失败 |
| pass 2/3 MySQL 集成门禁（空库 Flyway + 直连 JDBC 用例） | ✅ 7 项，0 失败 |
| pass 3/3 隔离库协作套件 | ✅ 303 项，0 失败 |
| 收尾 | ✅ `verify green`，容器已清理 |

## 3. 未执行的门禁

| 门禁 | 状态 | 说明 |
|---|---|---|
| 真实后端链路（SSE / 工具失败 / 断流取消） | ❌ 未执行 | 需要启动后端 + 真实依赖 |
| 真实数据库迁移（空库 + 升级路径） | ⚠️ 部分 | 空库迁移已由 `verify.sh` pass 2 覆盖；**已有库升级路径**未单独验证 |
| 真实跨用户权限隔离 | ❌ 未执行 | 需要两套账号与会话 |
| Playwright E2E | ❌ 未执行 | 需要可运行的前后端栈 |
| 双主题 / 响应式回归 | ❌ 未执行 | 需浏览器截图证据 |

## 4. 口径说明

- 合成单测通过 **不等于** 真实临床能力通过。本文件只陈述工程事实。
- 医疗边界保持默认关闭：医生正式复核写入门禁、多 Agent 生产开关均未改动。

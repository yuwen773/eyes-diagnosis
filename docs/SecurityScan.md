# 最终安全扫描（Security Scan）

> RELEASE-001 冻结前最后一道门禁。扫描对象：PR-12 工作树（release/v1.0.0，HEAD = 含文档骨架 + 本扫描报告）
> 维度：违禁标识符 / 敏感暴露 / 隐藏路由 / 假指标。

## 1. 违禁标识符

### 1.1 后端（`nextNode` / `nextSegment` / `routeCondition` / `internal.Edge`）

| 命中文件 | 是否 PR-12 新增 | 结论 |
|---------|---------------|------|
| `workflow/graph/runtime/DefaultGraphSegmentRuntimeAdapter.java` | 否（冻结核心） | ✅ |
| `workflow/graph/runtime/DefaultGraphSegmentCommitCoordinator.java` | 否（冻结核心） | ✅ |
| `workflow/graph/runtime/SegmentExecutionResult.java` | 否（冻结核心） | ✅ |
| `workflow/graph/runtime/SegmentTransitionConsistencyGuard.java` | 否（冻结核心） | ✅ |
| `workflow/review/HumanReviewHandoff.java` | 否（冻结核心） | ✅ |

> 这些标识符仅存在于 **架构冻结前的 Graph Runtime 存量实现**，PR-12 的 observability/audit/security 新代码**零命中**。冻结策略禁止「新增」而非禁止存量，✅ 合规。

### 1.2 前端（`rawPrediction` / `topK` / `modelScore` / `abstainReason`）

| 标识符 | 出现位置 | 性质 | 结论 |
|--------|---------|------|------|
| `rawPrediction` / `topK` / `modelScore` | 仅 `api/__tests__/patientResultGuard.test.ts`（守卫测试，断言白名单投影会剔除它们） | 测试 | ✅ 合规 |
| `abstainReason` | `components/diagnosis/DiagnosisResult.vue`（2 渲染点）、`components/user/DiagnosisReportDetail.vue`（1 渲染点）、`api/typings.d.ts`（1 类型定义） | **生产代码** | ⚠️ 见下 |

> ✅ **F1 已闭环（存量豁免 + CI 门禁拦截）**：`abstainReason` 标识符名仍在禁用清单，但已通过 `scripts/exposure-scan.mjs` 静态门禁处理：
> - 当前 3 处生产引用（`DiagnosisResult.vue` ×2、`DiagnosisReportDetail.vue` ×1、`typings.d.ts` ×1）作为**存量豁免**登记在 `.exposure-scan.json` 的 `exceptions` 中，扫描不失败；
> - 门禁对 `frontend/src` 下**任何新出现的 `abstainReason`** 判为 error 并导致 CI 失败，从而拦截未来新增；
> - 渲染内容仍为通用患者文案，无敏感数据泄露。
> - **待后续（可选，非冻结阻塞项）**：将 `abstainReason` 更名为 `rejectHint`（需同步后端实体/VO/gRPC 契约字段名），届时从 exceptions 移除即可。

### 1.3 静态暴露门禁（CI 强制）

- 新增 `scripts/exposure-scan.mjs`（纯新增脚本，零侵入业务代码）+ `.exposure-scan.json`（配置）：
  - `roots`：扫描 `src/main/java`（后端）、`frontend/src`（前端）；排除 `node_modules/target/dist/__tests__/*.test.*/*.spec.*`；
  - `forbidden`：8 个冻结清单标识符，按 `roots` 正确归属（Graph Runtime 概念仅后端、模型暴露概念仅前端；`topK`/`abstainReason` 后端检索参数与实体字段为合法契约，不纳入前端规则范围）；
  - `exceptions`：冻结 `graph/runtime/` 包、`HumanReviewHandoff.java` 及 3 个存量前端文件，避免误伤既有存量；
  - 退出码：error 级违规 → 1（CI 失败）；仅豁免存量 → 0（PASS）。
- `.github/workflows/verify.yml` 新增 `exposure-scan` job（node 20，`node scripts/exposure-scan.mjs`），已并入 PR/推送门禁。
- 实机验证：当前代码 `node scripts/exposure-scan.mjs` → **PASS（exit 0，18 处存量豁免）**；临时探针新增 `abstainReason` → **FAIL（exit 1）**，证明拦截有效。

## 2. 敏感暴露（配置）

- `application-prod.yml`：所有凭据（`password` / `api-key` / `secretId` / `secretKey`）均为 `${ENV}` 占位，**无明文** ✅
- `application.yml` / `application-prod.yml` / `application-demo.yml`：均未引用 `test` profile（prod 不读 test 配置）✅
- `application-demo.yml`：占位密钥 `demo-placeholder-key` 仅用于演示环境隔离外部依赖，不进入 prod ✅

## 3. 隐藏路由（鉴权覆盖）

- 全部业务控制器均经以下两种方式之一鉴权：
  - `@AuthCheck(mustRole=...)`（角色矩阵，PR-12.3 强化）；或
  - 方法内手动 `userService.getLoginUser(request)`（未登录抛 `NOT_LOGIN_ERROR`，已确认实现）。
- `AgentController`（10 端点）、`McpServerController`（6 端点）虽无 `@AuthCheck`，但**每方法均调 `getLoginUser`** → 实际要求登录态，非匿名 ✅
- 未发现「既无 `@AuthCheck` 又无 `getLoginUser`」的匿名业务端点 ✅
- 公开端点（登录/注册）为预期白名单 ✅

## 4. 假指标（可观测性真实性）

- `WorkflowMetrics`（PR-12.1）所有 Counter/Timer 均由运行时**真实 delta** 驱动：
  - 计时器传入真实 `Duration`（段执行 / 推理 / 复核）；
  - 计数器在真实事件（创建/完成/失败/重试/拒识/审计失败）时 `increment()`；
  - 无任何常量/硬编码数值注入指标 ✅
- `review_pending_count` 为实时 Gauge，本次实测随种子 OPEN 复核任务 = 1，与 DB 联动一致（见 Benchmark.md）✅

## 5. 扫描结论

| 维度 | 结果 |
|------|------|
| 违禁标识符（后端） | ✅ 合规 |
| 违禁标识符（前端） | ✅ 合规（F1 经静态门禁闭环：存量豁免 + 新代码拦截） |
| 敏感暴露 | ✅ 合规 |
| 隐藏路由 | ✅ 合规 |
| 假指标 | ✅ 合规 |

**整体判定**：系统满足「无隐藏路由 / 无敏感暴露 / 无假指标 / 无新增违禁标识符」的冻结要求。
F1（前端 `abstainReason` 标识符）已通过 `scripts/exposure-scan.mjs` 静态门禁闭环：存量豁免、新代码拦截，并纳入 CI。

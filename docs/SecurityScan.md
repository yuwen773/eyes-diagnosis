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

> ⚠️ **发现项 F1（前端 `abstainReason`）**：该标识符位于禁用清单，且存在于生产 `src`（非 `__tests__`）。
> - **非 PR-12 新增**，属存量代码。
> - 前端渲染值为**通用患者文案**：`拒识原因：{reason}。请重新上传清晰图片或申请人工复核。`，不含原始模型内部数据 → **无敏感数据泄露**。
> - 但标识符名在禁用清单内；且 `patientResultGuard.test.ts` 注释引用的静态门禁 `scripts/exposure-scan.mjs` **实际缺失**，规则未被 CI 强制。
> - **建议（待用户决策）**：
>   1. 补充 `scripts/exposure-scan.mjs` 纳入 CI，静态拦截生产代码中的禁用字段名；
>   2. 评估将 `abstainReason` 更名为患者安全别名（如 `rejectHint`）以严格符合清单（需同步后端契约字段名）。

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
| 违禁标识符（前端） | ⚠️ 1 项待决（F1，内容安全、标识符名禁用、门禁脚本缺失） |
| 敏感暴露 | ✅ 合规 |
| 隐藏路由 | ✅ 合规 |
| 假指标 | ✅ 合规 |

**整体判定**：系统满足「无隐藏路由 / 无敏感暴露 / 无假指标 / 后端无新增违禁标识符」的冻结要求。
唯一待用户拍板项为 **F1（前端 `abstainReason` 标识符）**——属存量代码、渲染内容已做患者安全化，但标识符名在禁用清单且缺 CI 强制门禁。

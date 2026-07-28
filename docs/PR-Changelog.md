# PR 交付逐条复盘（PR-01 ~ PR-12）

> 面向后续维护者 / 新同学。本文把每个 PR 拆成「做了什么 / 解决了什么风险 / 关键位置 / 注意点」，
> 让你在不动冻结代码的前提下快速建立全局认知。
>
> 阅读顺序建议：先读 `Architecture.md`（冻结清单与链路）→ 本文件（演进脉络）→ `DeveloperGuide.md`（构建与门禁）。
>
> 注：PR-01 分支基于"已具备医疗安全基线的主干"切出（auth BCrypt、用户隔离、OOD 拒识、温度校准、MCP 安全等已于此前落地），
> 因此 PR-01 的独有提交里混有这些前置基础；下文 PR-01 仅聚焦其**工作流领域契约**本身。

---

## PR-01 · 工作流领域契约（workflow domain contracts）

- **做了什么**
  - 建立 workflow 领域模型与契约（`workflow/domain`、`workflow/contract`）：状态枚举、`Segment` 边界、公共 API 形态。
  - 确立 **Graph 单 Tick 门禁**：一个 Segment 一次推进，推进语义不可被外部打断。
  - 配套架构测试：验证 Graph 原生 Segment 边界、公共 API 升级路径（`test(architecture)` 系列）。
- **解决了什么风险**
  - 此前工作流概念散落、无统一契约，Graph 执行边界与业务状态易耦合，演化时状态机漂移。
  - 领域契约 + 单 Tick 门禁把"工作流怎么推进"钉死，为后续 PR-02~PR-12 提供稳定地基。
- **关键位置**
  - `src/main/java/com/csust/eyediagnosis/workflow/domain/`、`workflow/contract/`
  - 冻结项：`WorkflowStatus` / `GraphDefinition` / Segment 边界（见 Architecture.md §7）
- **注意**：此 PR 定义的边界与状态枚举**已进入冻结清单**，后续只可装饰、不可改语义。

---

## PR-02 · 工作流持久化 + Flyway（persistence）

- **做了什么**
  - 建立 workflow 持久化模型：`workflow/persistence/{entity,mapper,repository,converter}`。
  - 建立 **Flyway V1–V14** 迁移链（演进表只增不改）。
- **解决了什么风险**
  - 工作流状态若无可靠落库，进程/容器崩溃即丢状态、不可恢复。
  - Flyway append-only 保证 schema 可重复、可回放、可演进，且与代码版本对齐。
- **关键位置**
  - `src/main/resources/db/migration/`（V1–V14）
  - `workflow/persistence/`（实体/映射/仓储）
  - 列名约定：workflow 表列名为**驼峰**（`workflowId` / `reviewTaskId` / `eventType`）。
- **注意**：新增迁移必须 append-only，禁止 `DROP`/`ALTER` 破坏存量；存量业务表（非 Flyway）变更须同步 `deploy/mysql/init/01_legacy_schema.sql`。

---

## PR-03 · Graph 定义注册 + 版本保护（graph definition registry）

- **做了什么**
  - `workflow/graph/registry` + `workflow/graph/definition`：图定义注册与版本保护。
  - 运行时只能消费"已注册且被版本锁定"的图定义。
- **解决了什么风险**
  - 图定义若可被运行时随意改写，行为不可复现、出问题无法定位"跑的是哪一版"。
  - 版本保护让"本次诊断跑过哪个图版本"可溯源、可冻结、可审计。
- **关键位置**
  - `workflow/graph/registry/GraphDefinitionRegistry.java`、`workflow/graph/definition/`
- **注意**：`GraphDefinition` 在冻结清单内；新增/改图定义需走版本号而非原地修改。

---

## PR-04 · 可靠 Segment Job（reliable job）

- **做了什么**
  - `workflow/job` + `workflow/runtime`：可靠作业基础设施（Job Claim、检查点、重试）。
  - 修正 Job Claim **全局排序索引**对齐（`0436ad3`），保证领取顺序可预期。
- **解决了什么风险**
  - 并发/分布式下任务被重复领取、执行乱序 → 数据不一致、重复推理。
  - 可靠 Job 提供 at-least-once + 幂等领取 + 检查点恢复，崩溃后可续跑而非重来。
- **关键位置**
  - `workflow/job/`、`workflow/runtime/`
- **注意**：Job Scheduler / Checkpoint 在冻结清单内，**禁止重构**；增强请走装饰器。

---

## PR-05 · Graph Segment 运行时适配（runtime adapter）

- **做了什么**
  - `workflow/graph/runtime`：将 Graph 执行接入 Segment 调度模型的适配层。
  - Segment 调度驱动 Graph，但**不改 Graph Runtime 内核**。
- **解决了什么风险**
  - 若直接在 Graph Runtime 中塞调度逻辑，会破坏 PR-01 冻结的路由/提交语义。
  - 适配层实现"零侵入挂接"范式（后续 PR-12 观测/审计沿用同一思路）。
- **关键位置**
  - `workflow/graph/runtime/`
- **注意**：graph·runtime 路由与提交语义已冻结；只可加适配层，不可改内核。

---

## PR-06 · 单次推理 + 不可变 Envelope（inference envelope）

- **做了什么**
  - `workflow/inference`：单次推理封装为**不可变 Envelope**（推理信封）。
  - AI 原始预测在信封内密封，链路全程只读。
- **解决了什么风险**
  - 预测结果在"证据→解释→发布"链路中被多处改写 → 不可信、不可审计、责任不清。
  - 不可变信封是**安全发布链的起点**：保证"AI 最初说了什么"永远可回溯。
- **关键位置**
  - `workflow/inference/`
- **注意**：Envelope 不可变是安全链根基；任何"改写预测"的需求都应改为新增字段/新信封，而非 mutate。

---

## PR-07 · 证据检索 + 来源治理（evidence governance）

- **做了什么**
  - `workflow/evidence`：Evidence Agent 检索与来源治理，产出**可追溯 Evidence Delta**。
  - 证据按用户隔离、可溯源（与既有 RAG/向量检索治理一致）。
- **解决了什么风险**
  - 解释若无证据支撑易"幻觉"、不可追责。
  - 来源治理让每条证据能回溯到其检索来源，支撑后续解释校验与审计。
- **关键位置**
  - `workflow/evidence/`
  - 关联：既有 `topK` 检索参数为后端合法契约（不在前端禁用清单范围）。

---

## PR-08 · 风险评估 + 证据约束解释（risk explanation）

- **做了什么**
  - `workflow/risk` + `workflow/explanation`：Risk Explanation Agent，生成患者可读解释快照。
  - 解释**受证据约束**：声明必须能被上游 Evidence Delta 回溯。
- **解决了什么风险**
  - 解释与证据脱节 → 患者看到无依据结论，医疗风险高。
  - 证据约束确保"解释说什么，证据能证明什么"一一对应。
- **关键位置**
  - `workflow/risk/`、`workflow/explanation/`

---

## PR-08b · 解释运行时接入（wire runtime）

- **做了什么**
  - 将最终"风险 + 解释"Graph 接入运行时（`workflow/graph` 运行时接线，`23ad8c6`）。
- **解决了什么风险**
  - 能力若只存在于单元测试、不接运行时 → 无法端到端生效，等于没做。
  - 接入后 PR-06~PR-08 的 Agent 能力在真实工作流中串联成链。
- **关键位置**
  - `workflow/graph/runtime/` 接线处

---

## PR-09 · 人工复核 + 协同决策（human review）

- **做了什么**
  - `workflow/review`：Human Review Agent，医生复核决策（可选介入）。
  - 复核任务可分配、可决策，决策回流驱动工作流继续/发布。
- **解决了什么风险**
  - AI 直接发布给患者 → 医疗责任与安全风险（误诊无兜底）。
  - Human-in-the-loop 在发布前插入医生决策点，是**安全发布链的关键闸**。
- **关键位置**
  - `workflow/review/`、`controller/workflow/ReviewController.java`（端点收敛至 DOCTOR_ROLE）
- **注意**：`ReviewDecision` / Review Decision Matrix 已冻结，不可改决策语义。

---

## PR-10 · 异步工作流 REST 网关（workflow API）

- **做了什么**
  - `controller/workflow/` + `workflow/api/`：暴露异步工作流 REST 网关。
  - 端点：`/api/diagnosis/workflows`（命令/查询）、`/reviews`、`/audit`、`/workflow/stats`。
  - 权限分层：Review → DOCTOR；Audit → 只读 AUDITOR。
- **解决了什么风险**
  - 前端/外部无法驱动长时工作流 → 系统不可用、无法集成。
  - API Contract 显式化 + 权限分层，避免越权访问业务/审计数据。
- **关键位置**
  - `src/main/java/com/csust/eyediagnosis/controller/workflow/`
  - `workflow/api/WorkflowCommandService.java`、`WorkflowStatsService.java`
- **注意**：API Contract 在冻结清单内；新增端点须沿用既有鉴权（见 `aop/AuthInterceptor.allowed()`）。

---

## PR-11 · 多智能体诊断工作流前端（frontend）

- **做了什么**
  - `frontend/src/pages/workflow/`：工作流前端体验。
  - 配套 `AgentExecutionTimeline.vue`（执行时间线）、`WorkflowDashboardPage.vue`（仪表盘）、`api/workflowStats.ts`。
- **解决了什么风险**
  - 强大后端无界面 → 无法演示、医生无法使用、价值不可见。
  - 前端把"多智能体一步步怎么跑"可视化，支撑演示与可解释性展示。
- **关键位置**
  - `frontend/src/pages/workflow/`、`frontend/src/components/workflow/`
  - E2E：`frontend/e2e/workflow-dashboard.spec.ts`
- **注意**：前端禁用字段 `rawPrediction`/`topK`/`modelScore`/`abstainReason` 由 `scripts/exposure-scan.mjs` 静态门禁拦截新增（存量豁免）。

---

## PR-12 · 生产化加固与演示环境（production hardening）

六大模块，且经**实机 Docker 部署验证（7 容器 Up）**：

| 子项 | 做了什么 | 解决的风险 | 关键位置 |
|------|---------|-----------|---------|
| **12.1 可观测性** | Micrometer 四类指标（workflow/segment/inference/review）+ MDC traceId 贯穿 JSON 日志 + Prometheus 端点 `/api/actuator/prometheus` | 线上黑盒，出事无法定位 | `workflow/observability/`（7 类，全 `@Primary` 装饰器零侵入） |
| **12.2 审计增强** | append-only 审计表 `t_workflow_audit_event` + 6 类事件（AI_INFERENCE_COMPLETED…RESULT_EXPOSED） | 操作不可追溯、责任不清 | `workflow/audit/`、`V14` 迁移、Repository 不暴露 update/delete |
| **12.3 权限强化** | `UserRole` 扩为 USER/DOCTOR/ADMIN/AUDITOR；Review→DOCTOR，Audit→只读 AUDITOR | 越权访问业务/审计数据 | `model/enums/UserRole.java`、`aop/AuthInterceptor.java`、`AuditController.java` |
| **12.4 部署环境** | docker-compose 全栈（mysql/redis/chroma/backend/frontend/prometheus/grafana）+ demo/prod profile | 无法一键交付、环境不一致 | `docker-compose.yml`、`Dockerfile`×2、`frontend/nginx.conf`、`application-demo.yml`/`application-prod.yml` |
| **12.5 Demo 数据** | `DemoDataSeeder`（双重隔离 + 幂等）：4 演示账号 + 3 案例（正常完成/人工复核/OOD 拒识） | 评审无现成数据、演示靠手搓 | `demo/`、`DemoDataSeeder.java` |
| **12.6 前端优化** | Dashboard + Agent Execution Timeline 路由 `/workflow/dashboard` | 执行过程不可视 | 见 PR-11 位置 |

- **实机验证暴露并修复的真实缺口**：全新库仅有 Flyway 表，缺 `t_user` 等 8 张早期存量表（不在 V1–V14 链内）→ 新增 `deploy/mysql/init/01_legacy_schema.sql`（幂等，挂载 `docker-entrypoint-initdb.d`），Demo 种子才成功。
- **关键位置**：`deploy/`（mysql 初始化、prometheus、grafana）、`demo/README.md`

---

## 横切结论：为什么这样演化

1. **先钉契约与状态真相（PR-01/02），再筑运行时（PR-04/05），最后叠智能体与治理（PR-06~09）** —— 顺序保证下层稳定、上层可演进。
2. **零侵入范式贯穿始终**：PR-05 适配层、PR-12 装饰器，都避免在冻结内核上改代码，使"架构冻结"与"能力增强"不冲突。
3. **安全发布链是红线**：Envelope 不可变（PR-06）→ 证据约束（PR-07/08）→ 人工复核（PR-09）→ 权限分层（PR-10/12.3）→ 审计（PR-12.2），任一环缺失都会回到"AI 预测直接给患者"的危险路径。
4. **可观测/可审计/可部署是交付门槛（PR-12）**：功能跑通 ≠ 可交付，PR-12 把"能演示"推到"能上线/能评审"。

> 后续维护者请严格遵守 `Architecture.md §7` 冻结清单与 `DeveloperGuide.md` 扩展约束；
> 任何增强走 `@Primary` 装饰器或新增适配层，不碰 `graph`/`runtime` 内核与冻结标识符。

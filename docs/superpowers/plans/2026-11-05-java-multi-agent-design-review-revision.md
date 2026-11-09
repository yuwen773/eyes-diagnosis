# Java 多智能体架构设计文档 v3 修订 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `docs/plans/2026-11-04-java-multi-agent-architecture-design.md`（v2 候选稿）修订为可通过设计评审的 v3，补齐持久化原子性、任务恢复、表结构闭合、受控证据边界、实施顺序与故障注入验收。

**Architecture:** 只修订一份 Markdown 设计文档，不改任何 Java 代码、不改 `frontend/`、不改迁移。修订以「先写验收断言 → 跑出 FAIL（v2 确实不达标）→ 改文档 → 跑出 PASS」的 TDD 式循环逐项落地。每个 Task 只碰文档中的少数章节锚点，避免并行写冲突。

**Tech Stack:** Markdown + Mermaid；验收断言用 `grep` / `git grep` / `git show`（只读）；Spring AI Alibaba Graph `1.1.2.2` 的 API 事实用 jar 类清单与 `mvn dependency:tree` 复核，**不**依赖主分支文档。

**Spec:** `docs/plans/2026-11-04-java-multi-agent-architecture-design.md`（v2，560 行，15 章 + 2 附录）。修订要求来自两轮设计评审：第一轮（`/superpowers:writing-plans`）逐条编入 §Global Constraints、§Review Focus、Task 1–11 与附录映射表；第二轮（v3 计划二次评审）的 3 项 P0 + 3 项增强已并入 Task 1/3/4/8/11 与 §验收分层。执行者无需外部文件。业务真源仍是 `feature/python-backend`（`c7b1b88`），只做 `git show` / `git grep` 只读核实。

## 适配说明（读前必看）

- **工作树**：当前会话已在 `D:\Work\code\eye-diagnosis\.claude\worktrees\java-multi-agent-arch`（分支 `worktree-java-multi-agent-arch`）。这是用户早前明确要求的隔离工作树，**不要重新创建 worktree**，所有命令只在此目录内运行，禁止 `cd` 到主检出。
- **commit**：用户未授权提交。每个 Task 的最后一步是「准备提交（给出建议 commit message）」，**不执行 `git commit` / `git add`**，除非用户另行明确要求。这是项目约定，优先于通用模板。
- **TDD 适配**：交付物是文档，故 "failing test" = 一条可运行的 `grep` 断言，检查 v3 必须出现（或必须消失）的锚点短语；"run to fail" 期望 v2 当前不达标；"implement" = 写入该章节的具体修订要点；"run to pass" 期望断言命中。所有断言都是真实可跑的，不是形式检查。
- **Interfaces 适配**：没有函数签名，改为「前一任务锁定/新增的章节锚点与术语」→「后一任务依赖的锚点与必须存在的短语」。
- **范围边界**：评审明确「暂不建议直接进入 P1–P6 全量开发」。本计划**只**修订设计文档，不实施任何 P0–P6 代码任务；文档内重排后的 P0–P6 是**给后续实施用的路线图**，不是本计划的任务。
- **验收分层（二次评审要求）**：最终 v3 必须区分两个结论，不得混为一谈 ——「**设计评审通过**」= 架构方案、接口契约、安全不变量与验证标准已明确；「**工程实施验收通过**」= 实际代码在真实 MySQL、Graph 运行时、跨进程恢复与并发故障注入条件下满足上述契约。本计划只产出前者。
- **框架门禁定位（二次评审要求）**：Task 2 要求的 Spring AI Alibaba Graph `1.1.2.2` 最小可运行验证，**本轮禁止编写任何 Java 代码**，只能作为后续 P2 实施门禁写进文档；文档修订通过**不代表**框架运行时恢复能力已验收。
- **断言不止于关键词（二次评审要求）**：`grep` 关键词断言保留，但 §11 最终验收另加**章节语义审查 + 表结构计数 + 状态机一致性检查**；出现关键词不等于实现方案正确。

## Global Constraints

逐字取自 v2 文档与本轮评审，所有 Task 隐含遵守：

- Spring Boot `3.5.6` / Java `21`；Spring AI `1.1.2` / Spring AI Alibaba `1.1.2.2`。
- `spring-ai-alibaba-graph-core:1.1.2.2` 由 `spring-ai-alibaba-agent-framework:1.1.2.2` 传递引入；**零新增依赖，不引入 langgraph4j**。
- Flyway 已应用 `V1`–`V9`，`validate-on-migrate: true`；**禁止修改已应用迁移**，只能新增；新迁移须跨分支核对 V10–V14 编号碰撞。
- 列名**小驼峰**，`map-underscore-to-camel-case: false`，全局 `isDelete` 逻辑删除；**禁止 `MysqlSaver` 自动建表**。
- `master` 与 `feature/python-backend` **不再互相合并**；`frontend/` 与 `algorithm/` 改动需人工搬运（`docs/backend-split.md:30-49`）。
- chat SSE 契约**零改动**：`MessageType` 六类（`assistant/user/tool-request/tool-result/tool-confirm/reasoning`）+ 唯一 `event: done`；`/events` 的 `done` **不代表任务完成**。
- 三个开关必须保持关闭：`eye-diagnosis.agent.outbox.enabled=false`、`upload.compensation.enabled=false`、`rag.corpus.seed-enabled=false`。
- 业务真源事实：Python 线 **14 节点**、图内**仅 1 个** `explanationDraft` LLM、`validate_claims` **10 类** issue、`Workflow.status` **9 态**、**4 类**人工等待；v2 §13 风险表当前为 **R1–R12（12 条）**，v3 目标为 **R1–R13（13 条）**。
- **表清单口径（二次评审 P0-2）**：v2 §9.1 是 **11 个分组行 / 14 张核心业务物理表**；Task 4 再新增 3 类持久化基础设施职责（输入 / checkpoint / pending writes）。v3 必须给出**统一可核算的清单**：`14 张核心业务表 + N 张持久化基础设施表`，`N` 以最终 Java DDL 选择为准（若三类各独立建表则 N=3、合计 17）；**禁止**一处写「14 张物理表」另一处又加表却不解释。
- **三种恢复机制（二次评审 P0-1）**：① 医生质量复核 / 最终临床复核 → 临床主图 `interrupt_after` 分段 + `Checkpoint` + `RESUME Job`（`review.py:228`、`worker.py:232`）；② 患者补充说明 → **独立聊天交互图** `interrupt()` + `Command(resume=text)`（`chat/supplement.py`，`chat-supplement-v1`），**绝不恢复或重跑临床诊断图、不重新推理、不重新发布解释**；③ 用户保存确认 `SAVE_DIAGNOSIS` → **图外**数据库事务 + CAS + 唯一回执（`confirmation.py:decide_save()`）。三者不可混用。
- **`completed` 语义（二次评审增强）**：Python 输出 `[*state["completed"], node]` 是**完整列表替换**（`definition.py:73` 等）；Java 侧 `completed` 必须用 `REPLACE`，**不能**把完整列表交给 `APPEND`，否则恢复重放会重复累积。
- **租约策略（二次评审 P0-3）**：`worker.py:63` 的 `lease_seconds: int = 30` 是可配置构造参数，但全仓**无心跳续租**；`_owned_rows()`（:136-137）靠 `lease_token + lease_version + lease_until` fencing，只能拒绝过期提交，**挡不住外部推理/LLM/检索被调用两次**。v3 必须写明可配置租约 + 心跳续租或有界任务执行 + 外部副作用幂等，**不得**宣称 `SKIP LOCKED` + 30s 租约保证全过程 exactly-once。
- 三权分离不可妥协：**医生复核 ≠ 用户保存授权**；`t_diagnosis` 只在患者 `approve` 保存确认后写入。
- `GRAPH_VERSION` / `ACTION_VERSION` / `GRAPH_HASH` 三元组；`ReviewTask` 绑定 `envelopeId` + 图三版本；不兼容直接 `FAILED/GRAPH_VERSION_INCOMPATIBLE`。
- Python 线**不是临床验证黄金标准**：`docs/backend-split.md` 仍有 4 项真人验收阻塞（AC-08 补充说明、AC-09 拒绝/批准保存、AC-11 医生复核、AC-21 完整 UI 走查）；Python 线「未切流」；模型 `NOT_CALIBRATED`、OOD `NOT_EVALUATED`。
- 分支基线以实测为准：工作树 HEAD `f11a677`、本地 `master` `bd597c1`、`feature/python-backend` `c7b1b88`；评审所述「GitHub master 位于 f11a677」属远端状态，写文档时区分本地/远端，不写死。

## Review Focus

spec 隐含但初始断言不覆盖、最可能咬人的失败模式。每条已在 owning task 内配有断言步骤：

1. **v3 仍把 `RedisSaver` 当正式人工等待的一期方案** → Task 2 Step 1/4 断言「RedisSaver 仅用于图引擎技术验证」且「正式启用人工等待前」必须同段出现。
2. **§8 仍写「借 `t_agent_message.subType` 存 `node:<name>`」** → Task 5 Step 1/4 断言该短语消失；`VARCHAR(30)` 与 31 字符节点名冲突必须被显式记录。
3. **风险表不是 R1–R13，且缺「输入与 Checkpoint 跨存储一致性」** → Task 9 Step 1/4 断言 `^\| R[0-9]+ \|` 计数为 13 且 R13 锚点存在。
4. **路线图仍 P4 人工等待 / P5 溯源倒置** → Task 7 Step 1/4 断言 P1 段含「持久化与安全底座」、P2 段含「Graph 技术验证」，且不可变快照/审计/防重放出现在人工复核之前。
5. **仍把 `UserBoundDocumentSearchTool` 当作临床可引用证据** → Task 6 Step 1/4 断言 `Controlled Evidence Boundary` 与 `no automatic promotion` 锚点存在。
6. **故障注入矩阵缺行** → Task 10 Step 1/4 断言 8 个场景锚点全部存在。
7. **Task 8 把患者补充说明误写成临床图 `Command(resume)`** → Task 8 Step 1/4 断言 `独立聊天交互图` 与 `不恢复或重新执行临床诊断图` 锚点，并断言旧的错误分类短语消失。
8. **表清单自相矛盾（14 张 + 新增 3 张却未重算）** → Task 4 Step 1/4 断言 `14 张核心业务表` 与 `持久化基础设施表` 口径锚点；Task 11 Step 3 做全表计数核算。
9. **30s 租约被当成 exactly-once 保证** → Task 3 Step 1/4 断言 `心跳续租` / `外部副作用幂等` / `不保证全过程 exactly-once` 锚点。

---

## File Structure

| 文件 | 责任 | 本计划动作 |
|---|---|---|
| `docs/plans/2026-11-04-java-multi-agent-architecture-design.md` | v2 设计稿，唯一的修订目标 | Task 1–11 逐章节修改 |
| `docs/superpowers/plans/2026-11-05-java-multi-agent-design-review-revision.md` | 本计划 | 已创建，不再修改 |
| `src/main/resources/db/migration/V4__agent_message_outbox.sql` | `subType VARCHAR(30)` 事实 | **只读**，Task 5 核实 |
| `feature/python-backend:algorithm/web/workflow/worker.py` | 单事务提交契约、`lease_seconds=30`、fencing、无续租 | **只读**，Task 2/3 核实 |
| `feature/python-backend:algorithm/web/chat/supplement.py` | 独立聊天补充图 `interrupt()` + `Command(resume)` | **只读**，Task 8 核实 |
| `feature/python-backend:algorithm/web/routers/review.py:228` | 医生复核 → `RESUME Job` | **只读**，Task 8 核实 |
| `feature/python-backend:algorithm/web/workflow/definition.py:73` 等 | `completed` 为完整列表替换 | **只读**，Task 8 核实 |
| `feature/python-backend:deploy/workflow-migrations/sql/V15__*.sql` | 输入/checkpoint/pending writes | **只读**，Task 4 核实 |
| `feature/python-backend:deploy/workflow-migrations/sql/V19__*.sql` | 受控证据治理列 | **只读**，Task 6 核实 |
| `feature/python-backend:algorithm/web/workflow/confirmation.py` | `decide_save()` 原子提交 | **只读**，Task 6 核实 |
| `feature/python-backend:docs/backend-split.md` | 4 项真人验收阻塞 | **只读**，Task 9 核实 |

所有 Task 共用同一个 Markdown 文件 → **必须顺序执行，不可并行**（同一文件的写会冲突）。

---

### Task 1: 状态标注、产品定位与分支基线事实

**Files:**
- Modify: `docs/plans/2026-11-04-java-multi-agent-architecture-design.md`（文档头 > 引用块、§0、§0.1 后、附录 B）

**Interfaces:**
- Consumes: v2 全文；实测 `git rev-parse` 结果。
- Produces: 锚点 `v3 修订候选稿，待设计评审`、`v2 候选稿，非冻结版`（作为历史状态保留在附录 B）、短语 `基于状态图的多阶段医疗 AI 工作流架构`、一张「分支基线事实表」；后续 Task 的章节号以此为准。

- [ ] **Step 1: 写验收断言**

```bash
grep -c "v3 修订候选稿，待设计评审" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "基于状态图的多阶段医疗 AI 工作流架构" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

- [ ] **Step 2: 跑断言确认 FAIL**

Run 上述两条；Expected: 均输出 `0`（v2 尚无状态标注与定位声明）。

- [ ] **Step 3: 写入修订**

在文档头引用块增加：**状态：v3 修订候选稿，待设计评审**；下一行写「由 v2 候选稿（非冻结版）修订而来，第一轮评审结论『方向认可、持久化与安全契约需补充、暂不全量开发』，第二轮评审『有条件通过、修正后执行』」；列出评审保留的 3 个决定（Python 业务真源、chat/workflow 解耦、人工复核/保存授权/溯源为独立安全边界）。**不要**在文档头把最终稿标成「v2 候选稿」——那是修订前的历史状态，只在附录 B 里保留。

增加「验收分层」短节：明确 **设计评审通过**（架构方案、接口契约、安全不变量、验证标准已明确）与 **工程实施验收通过**（实际代码在真实 MySQL、Graph 运行时、跨进程恢复、并发故障注入下满足契约）是两个不同结论；本文件是前者，不代表后者。特别注明：Spring AI Alibaba Graph `1.1.2.2` 的 Checkpoint/恢复/中断**最小可运行验证是后续 P2 实施门禁**，本轮未写任何 Java 代码，文档修订通过不等于框架运行时恢复能力已验收。

§0 增加产品定位声明：本方案本质是「**基于状态图的多阶段医疗 AI 工作流架构**」，含 1 个对话 Agent + 1 个受控诊断状态图 + 多工具 + 多人工决策角色，**14 个图节点 ≠ 14 个 Agent**；若目标改为真正的 Multi-Agent 研究，需另加明确 Agent 职责、独立上下文、协作协议与评估机制，而不是增加图节点数量；明确写「**不要为了让项目更像 Multi-Agent 而增加 LLM 节点**」。

新增「分支基线事实表」：工作树 HEAD `f11a677`（v2 基线）、本地 `master` `bd597c1`、`feature/python-backend` `c7b1b88`；注明评审所述远端 master `f11a677` 与本地差 1 个提交，实施前须 `git rev-parse` 复核，不写死远端状态。附录 B 增一行 v2→v3 变更。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 两条；Expected: 均输出 `1` 或更大。另跑 `grep -n "设计评审通过\|工程实施验收通过" ...` Expected: 两条均命中；`grep -n "不要为了让项目更像 Multi-Agent" ...` Expected: 1 行命中。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 标注 v3 修订候选稿状态、验收分层与产品定位`。**不运行 `git commit`。**

---

### Task 2: ADR-4 重写 — Checkpoint 与业务数据原子性（P0-1）

**Files:**
- Modify: 同文档 §4 ADR-4、§2.4 末段
- Read-only: `feature/python-backend:algorithm/web/workflow/worker.py`（`saver.flush(db)` 所在事务块）、`checkpoint.py`

**Interfaces:**
- Consumes: Task 1 的章节锚点。
- Produces: 短语 `RedisSaver 仅用于图引擎技术验证`、`正式启用人工等待前`、`同一事务`、`fail-closed`；Task 3 依赖这里的「单事务边界」定义。

- [ ] **Step 1: 写验收断言**

```bash
grep -c "RedisSaver 仅用于图引擎技术验证" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "正式启用人工等待前" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

- [ ] **Step 2: 跑断言确认 FAIL**

Expected: 均输出 `0`（v2 只写「一期用 RedisSaver 验证恢复链路」，没有禁用约束）。

- [ ] **Step 3: 写入修订**

重写 ADR-4，明确三层：

1. **业务表是真相、checkpoint 只管续跑**（保留 v2 结论）。
2. **RedisSaver 仅用于图引擎技术验证**（早期跑通 `StateGraph` 恢复链路），**禁止**作为正式人工等待链路的一期持久化方案。理由写清失败序列：图执行完成 → RedisSaver 写 Checkpoint → MySQL 更新 Workflow，两次写入之间崩溃会导致 checkpoint 与业务状态不一致。
3. **正式启用人工等待前**必须二选一：能与 MySQL 业务事务协调提交的自定义 `BaseCheckpointSaver`，或明确的 `fail-closed` 一致性恢复协议。引用 Python 线证据：`worker.py` 的 `saver.flush(db)` 与 `InferenceEnvelopeRow` 插入、`workflow` 更新、`Job` 完成、`ReviewTask`、下个 `RESUME Job`、`append_event` 全在 `with self.sessions.begin() as db:` **同一事务**；`checkpoint.py` 是段内暂存 + 栅栏式原子提交。

额外要求：必须针对锁定的 `1.1.2.2` 版本做 **Checkpoint / 恢复 / 中断 API 的最小可运行验证**（jar 类清单 + `mvn dependency:tree` 已证实类存在，但不自动证明自定义 Saver 满足事务要求），不能只引用主分支框架文档。**明确标注该验证是后续 P2 实施门禁**：本轮为文档修订、禁止编写任何 Java 代码，故此处只写「必须验证」的契约与验收标准，不写「已验证」；文档修订通过不代表框架运行时恢复能力已验收（对齐 Task 1 的验收分层）。§2.4 末段同步改为「checkpoint 与业务行同事务提交」表述。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 两条；Expected: 均输出 `1`。另跑 `grep -n "同一事务\|fail-closed" ...` Expected: ADR-4 段内各至少 1 行。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): ADR-4 收紧 checkpoint 与业务数据原子提交契约`。**不运行 `git commit`。**

---

### Task 3: 异步执行器可靠性契约（P0-2）

**Files:**
- Modify: 同文档 §4（新增 ADR-4b 或 ADR-5 内补）、§5.2 组件表「异步执行器」行、§6.2
- Read-only: `feature/python-backend:algorithm/web/workflow/worker.py`（`claim()` / `run_once()`）、`models.py`（`Job` 字段）

**Interfaces:**
- Consumes: Task 2 的「单事务边界」。
- Produces: 短语 `@Async 只能异步运行，不能保证任务可恢复、租约隔离与执行幂等`、`SKIP LOCKED`、`心跳续租`、`外部副作用幂等`、`不保证全过程 exactly-once`、Job 字段清单 `leaseOwner/leaseToken/leaseUntil/attempt/maxAttempts/availableAt/epoch`；Task 4 依赖这些字段。

- [ ] **Step 1: 写验收断言**

```bash
grep -c "@Async 只能异步运行，不能保证任务可恢复、租约隔离与执行幂等" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "不保证全过程 exactly-once" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

- [ ] **Step 2: 跑断言确认 FAIL**

Expected: 均输出 `0`（v2 只写「Spring 的异步执行 + 数据库状态驱动推进」）。

- [ ] **Step 3: 写入修订**

新增执行器契约，逐条写明：

- 明确 **`@Async` 只能异步运行，不能保证任务可恢复、租约隔离与执行幂等**；禁止把它当作可靠性机制。
- Job 领取：`SKIP LOCKED` 抢占（或等效的单领取者保证）+ **可配置租约**（Python `worker.py:63` 的 `lease_seconds: int = 30` 是构造参数而非硬编码，Java 不得无条件照搬 30s）；字段 `leaseOwner` / `leaseToken` / `leaseVersion` / `leaseUntil` / `attempt` / `maxAttempts` / `availableAt` / `epoch` / `graphThreadId` / `graphCheckpointId`。
- **长耗时任务策略（二次评审 P0-3）**：眼底图片推理、远程 LLM、证据检索可能超过租约。写明竞争序列 `T+0 A 领取 / T+30 租约过期 / T+31 B 重新领取 / T+40 A 返回但失去提交资格`，并指出 Python `_owned_rows()`（`:136-137`）的 `lease_token + lease_version + lease_until` fencing 只能拒绝过期 Worker 的数据库提交，**不能阻止外部推理/LLM/检索被调用两次**。因此必须补 **可配置租约 + 心跳续租或有界任务执行 + 外部副作用幂等键**（推理按 `requestDigest`、LLM 按调用幂等键、检索按证据版本去重），并**明确写「`SKIP LOCKED` + 30s 租约不保证全过程 exactly-once」**。
- 领取时校验 `graph_version/hash/action_version` 与 `envelopeId`，不兼容 → `FAILED/GRAPH_VERSION_INCOMPATIBLE`，**不自动重跑**。
- 用图的 `get_state().next` 生成下个 `RESUME Job`；图执行、checkpoint flush、envelope、workflow、Job 完成、ReviewTask、下个 Job、审计事件**在同一 MySQL 事务提交**（引用 Task 2 的边界）。
- 失败分类：可重试 → `RETRY_WAIT` + 退避；永久 → `FAILED` + `stopReasonCode`；`append_event` 记录每次尝试。
- §5.2 组件表「异步执行器」行补上「租约 + 心跳 + 幂等 + 单事务提交」。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 两条；Expected: 均输出 `1`。另跑 `grep -n "心跳续租\|外部副作用幂等\|SKIP LOCKED" ...` Expected: 三项各至少 1 行。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 补全执行器租约、续租、外部副作用幂等与恢复契约`。**不运行 `git commit`。**

---

### Task 4: 数据模型闭合 — 输入、Checkpoint、pending writes（P0-3）

**Files:**
- Modify: 同文档 §9.1 表格、§9 新增 9.1b 小节
- Read-only: `feature/python-backend:deploy/workflow-migrations/sql/V15__python_durable_upload.sql`

**Interfaces:**
- Consumes: Task 3 的 Job 字段清单。
- Produces: **统一可核算的表清单口径** `14 张核心业务表 + N 张持久化基础设施表`（N 以最终 Java DDL 为准）；三类恢复存储 `t_workflow_upload_input` / `t_python_graph_checkpoint` / `t_python_graph_write` 的 Java 对应设计；Task 8 依赖这里的 checkpoint 存储定义；Task 11 依赖这里的计数做语义核算。

- [ ] **Step 1: 写验收断言**

```bash
grep -c "14 张核心业务表" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "持久化基础设施表" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "pending writes" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

- [ ] **Step 2: 跑断言确认 FAIL**

Expected: 均输出 `0`（v2 只写「11 类新表」，未拆物理表、未提 pending writes、未给统一口径）。

- [ ] **Step 3: 写入修订**

§9.1 明确写出 v2 的 **11 个分组行 / 14 张核心业务物理表**，逐表列全（含被 `/` 合并的 `t_workflow_job` / `t_workflow_node_execution`、`t_explanation_snapshot` / `t_diagnosis_citation`、`t_diagnosis_save_confirmation` / `t_saved_workflow_diagnosis`），消除「11 类表」的歧义。

**统一表清单口径（二次评审 P0-2）**：在 §9 起首给出一张总表 —— `14 张核心业务表 + N 张持久化基础设施表`，并明确 `N` 由最终 Java DDL 选择决定：若输入 / checkpoint / pending writes 三类各自独立建表，则 `N=3`、**合计 17 张**；若合并存储（如 checkpoint 与 pending writes 同表按 `valueType` 区分）则 `N` 相应减少并写明理由。**禁止**文档一处写「14 张物理表」、另一处新增 3 张表却不重算总数。§9.1b 的每个表名都要能在总表里被计数。

新增 §9.1b「持久化输入与恢复存储」，回答三个问题（**Java 不照搬 Python 表名和存储实现，但必须回答**）：

1. **图片原始输入或不可变对象引用如何保存** → 对应 `t_workflow_upload_input`：`workflowId` / `requestDigest` / `imageBytes`（或 COS 不可变对象引用 + 摘要）/ `graphCheckpointId` / `completedNodes` / `evidenceSnapshot`；写入后不可变，恢复时用摘要绑定推理信封。
2. **Checkpoint 如何持久化** → 对应 `t_python_graph_checkpoint`：`threadId` / `checkpointNamespace` / `checkpointId` / `parentCheckpointId` / `valueType` / `checkpointValue` / `metadataJson`；必须与业务行同事务（Task 2）。
3. **未完成节点写入如何恢复** → 对应 `t_python_graph_write`（pending task outputs）：`taskId` / `writeIndex` / `channel` / `valueType` / `writeValue`；用于崩溃后重放未完成节点输出，禁止重复累积。

同时说明 Java 线不使用 `MEDIUMBLOB` 存图的可行性选项与取舍（COS 对象引用 + 摘要），但**必须保留等价的不可变输入绑定语义**。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 三条；Expected: 均输出 `1`。另做**人工计数核算**（不是 grep）：逐行数 §9.1 + §9.1b 的物理表名，确认总数与 §9 起首总表写明的 `14 + N` 一致。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 闭合数据模型，统一表清单口径并补输入/checkpoint/pending writes`。**不运行 `git commit`。**

---

### Task 5: 移除 subType 溢出设计（P0-3 附）

**Files:**
- Modify: 同文档 §8 第 2 条
- Read-only: `src/main/resources/db/migration/V4__agent_message_outbox.sql:6,21`

**Interfaces:**
- Consumes: Task 4 的 `t_workflow_node_execution` 与 `t_diagnosis_workflow_event`。
- Produces: §8 不再出现 `subType` 复用短语；chat SSE 契约零改动结论不变。

- [ ] **Step 1: 写验收断言（负向）**

```bash
grep -c "借 \`t_agent_message.subType\` 存" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -n "subType VARCHAR(30)" src/main/resources/db/migration/V4__agent_message_outbox.sql
```

- [ ] **Step 2: 跑断言确认 FAIL**

Expected: 第一条输出 `1`（v2 确有该设计，不应保留）；第二条输出 2 行（:6 与 :21），确认字段长度事实。

- [ ] **Step 3: 写入修订**

删掉「中间节点身份借 `t_agent_message.subType` 存 `node:<name>`」整条设计，替换为：

- 记录事实错误：`V4__agent_message_outbox.sql:6,21` 定义 `subType VARCHAR(30)`，而 `node:explanationClaimValidation` 为 **31 字符**，直接写入会溢出。
- 必要性问题：既然 chat 与工作流完全独立，**不应为记录工作流节点改造聊天消息结构**；按双层解耦原则，工作流节点身份写入**独立的执行与审计记录**（`t_workflow_node_execution` / `t_diagnosis_workflow_event`），chat 消息表零改动。
- 保留 §8 其余结论：`MessageType` 六类 + 唯一 `done` 不变、`tool-result`/`tool-response` 漂移、`V22` 工具确认、LLM 工具调用只产生同意意图。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 第一条；Expected: 输出 `0`。另跑 `grep -c "独立的执行与审计记录" ...` Expected: `1`。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 移除 subType 溢出设计，节点身份改走独立审计记录`。**不运行 `git commit`。**

---

### Task 6: Controlled Evidence Boundary 与保存授权事务（P0-4）

**Files:**
- Modify: 同文档 §4（新增 ADR-7b）、§7 节点 7/9/12/13 行、§3.2
- Read-only: `feature/python-backend:deploy/workflow-migrations/sql/V19__controlled_reference_evidence.sql`、`feature/python-backend:algorithm/web/workflow/confirmation.py`（`decide_save()`）

**Interfaces:**
- Consumes: Task 4 的 `evidenceSnapshot`；Task 3 的单事务边界。
- Produces: `Controlled Evidence Boundary`、`no automatic promotion`、治理列清单、保存授权三写原子提交；Task 10 依赖这里的「引用撤回」场景。

- [ ] **Step 1: 写验收断言**

```bash
grep -c "Controlled Evidence Boundary" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "no automatic promotion" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

- [ ] **Step 2: 跑断言确认 FAIL**

Expected: 均输出 `0`。

- [ ] **Step 3: 写入修订**

新增 **ADR-7b / Controlled Evidence Boundary**，逐条写明：

- `UserBoundDocumentSearchTool` 只解决**按用户隔离检索**，**不等于**经管理员批准、未撤回、可引用、版本仍有效的临床证据。引用 V19 原文注释 "Existing documents are private and unreviewed; **no automatic promotion**"。
- 明确区分**普通用户知识库**与**受控临床参考资料**；治理列对齐 V19：`visibility`（默认 `PRIVATE_USER`）/ `reviewStatus`（默认 `PENDING`）/ `diseaseCodes` / `topicCodes` / `governanceVersion` / `reviewedBy` / `reviewedAt`。
- `evidenceValidation`、`explanationClaimValidation`、`explanationPublication` 必须使用**同一套可验证证据版本 + `citationDigest`**；发布时复验，来源变更 → `WITHHELD` / `EXPLANATION_SOURCE_CHANGED`（对齐 `patient_explanation()` 的重验逻辑）。
- §7 的 7/9/12/13 节点「复用的 Java 线能力」列改为受控证据检索，而非普通 RAG。

保存授权事务边界（补进 §3.2）：以 Python `decide_save()` 为契约参考，**状态 CAS 成功 + 正式 `t_diagnosis` 记录插入 + 唯一 `SavedWorkflowDiagnosis` 回执写入必须在同一事务原子提交**（原文注释 "Consent, receipt and formal row succeed or roll back together"）；`PENDING` + `expiresAt` + `expectedContentDigest` + `expectedWorkflowVersion` 校验；重复 approve 只回放已提交回执，绝不重跑写入。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 两条；Expected: 均输出 `1`。另跑 `grep -n "同一事务原子提交" ...` Expected: 至少 1 行。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 补受控证据边界与保存授权原子提交契约`。**不运行 `git commit`。**

---

### Task 7: 实施顺序重排 P0–P6（P1 不变量倒置）

**Files:**
- Modify: 同文档 §12 路线图表、§12 末段底线说明

**Interfaces:**
- Consumes: Task 2–6 的契约。
- Produces: 评审给定的 7 阶段顺序；短语 `持久化与安全底座`、`Graph 技术验证`；Task 9/10 依赖这里的阶段编号。

- [ ] **Step 1: 写验收断言**

```bash
grep -c "持久化与安全底座" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "Graph 技术验证" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

- [ ] **Step 2: 跑断言确认 FAIL**

Expected: 均输出 `0`（v2 的 P1 是「数据层」、P2 是「图骨架」，顺序倒置）。

- [ ] **Step 3: 写入修订**

按评审重排 §12 表格：

| 阶段 | 内容 | 验收标志 |
|---|---|---|
| **P0 契约冻结** | 锁定 Python 基线、API、状态码、图版本、验收样例 | 样例与分支 SHA 固定 |
| **P1 持久化与安全底座** | 数据库迁移、输入绑定、Job 租约、事务、审计、幂等 | 单事务提交 + 租约隔离可测 |
| **P2 Graph 技术验证** | 14 节点拓扑、状态合并、Checkpoint、跨进程恢复 | 1.1.2.2 最小可运行验证通过 |
| **P3 确定性诊断链** | gRPC 推理、风险门控、受控证据、声明校验 | 各分支 `stopReasonCode` 对齐 |
| **P4 人工等待与发布** | 医生复核、患者补充、冻结快照、发布状态机 | 四态可跨重启恢复 |
| **P5 保存授权与溯源** | 摘要确认、过期、CAS、唯一回执、旧任务显式重建 | 未授权不写 `t_diagnosis` |
| **P6 前端与 Chat 集成** | 工作流页面、SSE 快照、引用关联、端到端验收 | 全链路验收 |

末段明确：**P1 的持久化事务、租约与幂等是后续开发的基础，不是 P4 出现真实人工等待时才补的补丁**；**不可变快照、审计与防重放必须早于人工复核和发布能力**（修正 v2 把溯源放 P5 的倒置）。保留底线句：「每一阶段都必须保持 chat SSE 契约不变 + 三权分离 + 未授权不写正式记录」。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 两条；Expected: 均输出 `1`。另核对 `grep -n "^| \*\*P[0-6]" ...` Expected: 正好 7 行。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 重排 P0–P6，持久化与溯源底座前置`。**不运行 `git commit`。**

---

### Task 8: `completed` 语义与三种恢复机制（P0-1 + P1）

**Files:**
- Modify: 同文档 §4 ADR-3、§3.3 表格下新增段落、§6.2
- Read-only: `feature/python-backend:algorithm/web/chat/supplement.py`（独立补充图）、`algorithm/web/routers/review.py:228`（RESUME Job）、`algorithm/web/workflow/definition.py:73` 等（`completed` 完整列表）、`algorithm/web/workflow/worker.py:232`

**Interfaces:**
- Consumes: Task 4 的 checkpoint/pending writes 定义、Task 3 的 RESUME Job。
- Produces: `APPEND 只接受增量`、`completed 使用 REPLACE`、**三种**恢复机制分类表、锚点 `独立聊天交互图` / `不恢复或重新执行临床诊断图`；Task 10 依赖「任一节点中断后重启」场景。

- [ ] **Step 1: 写验收断言**

```bash
grep -c "APPEND 只接受增量" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "completed 使用 REPLACE" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "独立聊天交互图" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "不恢复或重新执行临床诊断图" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

- [ ] **Step 2: 跑断言确认 FAIL**

Expected: 四条均输出 `0`（v2 只写「`APPEND` 用于 `errors` / `trace`」，且把补充说明误归为图内 `Command(resume)`）。另跑负向断言 `grep -c "图内 interrupt 类.*患者补充说明" ...` Expected: 该错误分类在 v3 应消失，Step 4 复查。

- [ ] **Step 3: 写入修订**

**`completed` 语义（二次评审增强）**：明确 Python 输出 `[*state["completed"], node]` 是**完整列表替换**（`definition.py:73` 等），故 Java 侧 **`completed` 使用 `REPLACE`**，**不得**把完整列表交给 `APPEND`，否则恢复重放会把已有节点重复累积。ADR-3 补充：**`APPEND` 只接受增量**（节点输出带去重键 / `writeIndex`），恢复重放时不得重复累积 `errors` / `trace`；`REPLACE` 用于单写入者 key（含 `completed`）；单写入者原则不变。引用 Task 4 的 `t_python_graph_write` 的 `taskId + writeIndex` 作为幂等依据。

§3.3 下新增「**三种恢复机制（不可混用）**」表，逐行给出机制、归属、禁止事项：

| 类型 | 正确恢复方式 | 禁止 |
|---|---|---|
| ① 医生质量复核 `IMAGE_QUALITY_GATE` / ② 医生最终临床复核 `FINAL_CLINICAL_REVIEW` | **临床主图** `interrupt_after` 分段 + Checkpoint + `RESUME Job`（`review.py:228`、`worker.py:232`），绑定 `envelopeId` + 图三版本 + `checkpointId` | 不重新推理、不换 envelope |
| ④ 患者补充说明 | **独立聊天交互图** `interrupt()` + `Command(resume=text)`（`chat/supplement.py`，`chat-supplement-v1`，单节点 `waitForDescription`，thread `supplement:<requestId>`，自带 `waitVersion` CAS + `t_python_chat_supplement`） | **不恢复或重新执行临床诊断图、不重新推理、不重新发布解释**；补充答案仅供 `doctor_notes()` 提供给医生 |
| ③ 用户保存确认 `SAVE_DIAGNOSIS` | **图外**数据库事务 + CAS + 唯一回执（`confirmation.py:decide_save()`） | 不走图 checkpoint、不走 RESUME Job |

明确写「**两类医生复核、独立聊天补充、图外保存确认是三种不同机制，不能直接套用同一种恢复机制**」；删掉 v2/初稿里「患者补充说明走 checkpoint + RESUME Job」的错误表述；「任一图节点中断后重启，恢复位置与业务状态一致」仅适用于临床主图的 `interrupt_after` 分段。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 四条；Expected: 均输出 `1`。另跑负向断言 `grep -c "图内 interrupt 类" ...` Expected: `0`（旧的两类分类短语已移除）。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 纠正三种恢复机制与 completed REPLACE 语义`。**不运行 `git commit`。**

---

### Task 9: 风险登记 R13 与临床验收边界（P1）

**Files:**
- Modify: 同文档 §13 风险表、§1.2 非目标
- Read-only: `feature/python-backend:docs/backend-split.md`（当前状态段）

**Interfaces:**
- Consumes: Task 7 的阶段编号；Task 2 的跨存储一致性风险。
- Produces: `^\| R[0-9]+ \|` 计数为 13；R13 锚点；临床验收边界声明。

- [ ] **Step 1: 写验收断言**

```bash
grep -cE '^\| R[0-9]+ \|' docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

Expected 初始为 `12`。

- [ ] **Step 2: 跑断言确认 FAIL**

Run Step 1 命令；Expected: `12`（v2 是 R1–R12；上一轮交付摘要误报「13 条」，实为口误；此处的 FAIL 指「不等于目标值 13」）。

- [ ] **Step 3: 写入修订**

新增 **R13：输入与 Checkpoint 跨存储一致性风险** —— 图片/COS 对象引用、checkpoint、pending writes 与业务行若分属不同存储且不同事务，崩溃后会错误恢复或发布不一致结果；缓解：Task 2/4 的单 MySQL 事务 + 不可变 `requestDigest` 绑定 + fail-closed。

§1.2 非目标或 §13 末段新增「临床验收边界」：Python 线可作**业务实现真源**，但**不是已获临床验证的黄金标准**；引用 `docs/backend-split.md`：4 项真人验收阻塞（AC-08 补充说明、AC-09 拒绝/批准保存、AC-11 医生复核、AC-21 完整 UI 走查）、Python 线「未切流」；模型 `NOT_CALIBRATED`、OOD `NOT_EVALUATED`；Java 线不得把「与 Python 对齐」表述为「临床有效」。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 2 命令；Expected: `13`。另跑 `grep -n "不是已获临床验证的黄金标准" ...` Expected: 1 行。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 补 R13 跨存储一致性风险与临床验收边界`。**不运行 `git commit`。**

---

### Task 10: 验证策略补故障注入矩阵（§14）

**Files:**
- Modify: 同文档 §14

**Interfaces:**
- Consumes: Task 2/3/6/8 的契约场景。
- Produces: 8 行故障注入矩阵；Task 11 依赖这里的验收项清单。

- [ ] **Step 1: 写验收断言**

```bash
for s in "Checkpoint 写入后进程崩溃" "两个 Worker 同时领取同一任务" "医生重复提交、跨账号提交" "患者同时点击两次批准保存" "解释草稿生成后引用资料被撤回" "图升级后恢复旧任务" "任一图节点中断后重启" "SSE 收到 event: done"; do grep -c "$s" docs/plans/2026-11-04-java-multi-agent-architecture-design.md; done
```

- [ ] **Step 2: 跑断言确认 FAIL**

Expected: 输出 8 个 `0`（v2 §14 只有正常流程与状态对齐，无故障注入）。

- [ ] **Step 3: 写入修订**

在 §14 新增「故障注入测试矩阵」表，逐行给出场景 → 必须证明的性质：

| 场景 | 必须证明的性质 |
|---|---|
| Checkpoint 写入后进程崩溃 | 不会错误恢复或发布不一致的结果 |
| 两个 Worker 同时领取同一任务 | 最多一个有效提交 |
| 医生重复提交、跨账号提交 | 幂等或明确拒绝，不能越权 |
| 患者同时点击两次批准保存 | 只能生成一条正式记录和唯一回执 |
| 解释草稿生成后引用资料被撤回 | 不能继续发布旧解释 |
| 图升级后恢复旧任务 | 不兼容时明确拒绝，不自动重跑 |
| 任一图节点中断后重启 | 恢复位置与业务状态一致 |
| SSE 收到 `event: done` | 仅表示当前传输完成，不误判工作流完成 |

保留 §14 原有 1–8 项（语义对齐、不变量、节点级单测、图级单测、恢复测试、`mvn test` 81/0/0/7、集成冒烟、门禁）。

- [ ] **Step 4: 跑断言确认 PASS**

Run Step 1 的 for 循环；Expected: 输出 8 个 `1` 或更大。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): 验证策略补 8 项故障注入矩阵`。**不运行 `git commit`。**

---

### Task 11: 全文一致性核查与附录更新

**Files:**
- Modify: 同文档 附录 A 证据索引、附录 B
- Verify: 全文

**Interfaces:**
- Consumes: Task 1–10 所有锚点。
- Produces: 可交付的 v3；最终 `git status --short` 证据。

- [ ] **Step 1: 写一致性验收断言**

```bash
grep -c '^```' docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -cE '^\| R[0-9]+ \|' docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "14 节点" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
grep -c "10 类" docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

- [ ] **Step 2: 跑断言确认基线**

Expected: 代码围栏计数为**偶数**（当前 8）；风险行 `13`；`14 节点` ≥1；`10 类` ≥1。任一不符即为回归，先修再继续。

- [ ] **Step 3: 写入修订**

附录 A 补本轮新引用的只读证据行：`worker.py`（`saver.flush(db)` 事务块、`:63` 可配置租约、`:136-137` fencing）、`checkpoint.py`、`chat/supplement.py`（独立补充图）、`routers/review.py:228`（RESUME Job）、`definition.py:73`（`completed` 完整列表）、`V15__python_durable_upload.sql`、`V19__controlled_reference_evidence.sql`、`confirmation.py` 的 `decide_save()`、`docs/backend-split.md`（4 项真人验收阻塞）、`V4__agent_message_outbox.sql:6,21`。

附录 B 把「与草案 v1 的变更」扩为两列对照（v1→v2 已保留，新增 v2→v3 行）：状态标注升级为 v3、验收分层、ADR-4 原子性 + P2 门禁定位、执行器租约/续租/外部副作用幂等、数据模型闭合与统一表清单口径、subType 移除、受控证据边界、P0–P6 重排、三种恢复机制与 `completed REPLACE`、R13 与临床边界、故障注入矩阵。

全文复查：不再出现 `15 节点` / `8 类` / `8 类表` / `qwen3.5-plus` 作为默认值 / `13 条风险` 口误；`11 类新表` 改为 `11 个分组行 / 14 张核心业务表`；表总数口径统一为 `14 张核心业务表 + N 张持久化基础设施表`；所有 `feature/python-backend:` 引用仍为只读 `git show` 形式。

- [ ] **Step 4: 跑最终验收（关键词 + 语义双层）**

**第一层 · 关键词断言**（重跑 Task 1–10 全部断言，Expected: 全部 PASS）。

**第二层 · 语义审查（二次评审要求，非 grep）**，逐项人工核对并在交付说明里写明结论：

1. **三类恢复机制语义**：§3.3 表中医生复核 = 临床主图 Checkpoint + RESUME Job；患者补充 = **独立聊天交互图** `interrupt()` + `Command(resume)` 且明确「不恢复或重新执行临床诊断图 / 不重新推理 / 不重新发布解释」；保存确认 = 图外事务 CAS + 唯一回执。三者无交叉、无「补充说明走 RESUME Job」残留。
2. **完整物理表清单与计数**：逐行数 §9.1 + §9.1b 的物理表名，与 §9 起首总表 `14 + N` 一致；若 N=3 则合计 17，且每个表名都能在总表里被计数；不存在「一处 14 张、另一处加表不重算」。
3. **事务原子性**：ADR-4 单事务、Task 3 执行器单事务、Task 6 保存授权三写原子提交三处表述一致，且都写明「崩溃时不产生不一致状态」的可验收判据。
4. **状态机一致性**：`Workflow.status` 9 态与 §6 条件边每条终态对应；解释发布状态机 `NONE→DRAFT→VALIDATED→PUBLISHED` + `REJECTED/WITHHELD` 与 §3.4、§7、§6 三处表述一致；四类人工等待的进入/恢复/终态不互相矛盾。
5. **8 项故障注入矩阵**：表格 8 行齐全，且每行「必须证明的性质」都能在 §2/§3/§4/§6 找到对应的契约依据（不是孤立口号）。
6. **验收分层**：文档头与附录均未把「设计评审通过」写成「工程实施验收通过」；框架最小可运行验证明确标为 P2 门禁、未声称已验证。

**第三层 · 结构断言**：

```bash
git status --short
wc -l docs/plans/2026-11-04-java-multi-agent-architecture-design.md
```

Expected: `git status --short` 恰好 2 行 —— `?? docs/plans/2026-11-04-java-multi-agent-architecture-design.md` 与 `?? docs/superpowers/plans/2026-11-05-java-multi-agent-design-review-revision.md`；**无 `M ` 行**（未改任何现有文件、未碰主检出）；行数 > 560；代码围栏计数为偶数。

- [ ] **Step 5: 准备提交（不执行）**

建议信息：`docs(arch): v3 全文一致性核查与证据索引更新`。**不运行 `git commit`。** 提交前须经用户设计评审通过。

---

## 附录：评审要求 → Task 映射（自包含）

| 评审项 | 优先级 | Task |
|---|---|---|
| 产品定位更名 / 不要为 Multi-Agent 增加 LLM 节点 | — | 1 |
| 分支基线事实区分 | — | 1 |
| Redis Checkpoint 与 MySQL 不能原子提交 | P0 | 2 |
| Graph 1.1.2.2 Checkpoint/恢复/中断 API 最小验证 | P0 | 2 |
| `@Async` 不保证可恢复/租约隔离/幂等 | P0 | 3 |
| §9 漏输入保存、Checkpoint、pending writes | P0 | 4 |
| §9.1 11 分组行 / 14 物理表歧义 | P0 | 4 |
| `subType VARCHAR(30)` 溢出 + 不应改 chat 消息结构 | P0 | 5 |
| Controlled Evidence Boundary | P0 | 6 |
| 保存授权 CAS + 正式记录 + 唯一回执原子提交 | P0 | 6 |
| P4/P5 不变量倒置，重排 P0–P6 | P1 | 7 |
| `APPEND` 重试重复累积 | P1 | 8 |
| 四类人工等待缺统一恢复契约（v3 细化三种机制） | P1 | 8 |
| 模型校准 / 临床有效性未验收 | P1 | 9 |
| R1–R12 → R1–R13（跨存储一致性） | P1 | 9 |
| 8 项故障注入测试矩阵 | — | 10 |
| 全文一致性 / 附录证据索引 | — | 11 |

### 二次评审项 → Task 映射

| 二次评审项 | 优先级 | Task |
|---|---|---|
| Task 8 混淆两种 Graph 恢复机制 → 明确**三种**机制，补充说明不恢复临床图 | **P0-1** | 8（+ Global Constraints / Review Focus 7 / Task 11 语义审查 1） |
| Task 4 表总数需重新定义 → `14 张核心业务表 + N 张基础设施表`，统一可核算 | **P0-2** | 4（+ Global Constraints / Review Focus 8 / Task 11 语义审查 2） |
| Task 3 30s 租约缺长耗时策略 → 可配置租约 + 心跳续租 + 外部副作用幂等，不宣称 exactly-once | **P0-3** | 3（+ Global Constraints / Review Focus 9） |
| Task 1 状态标注应为「v3 修订候选稿，待设计评审」 | 增强 | 1 |
| `completed` 明确为完整列表替换 → Java 用 `REPLACE`，不能交给 `APPEND` | 增强 | 8 |
| 验收断言不止 grep → 加章节语义审查 / 表计数 / 状态机一致性 | 增强 | 11 Step 4 第二层 |
| Graph `1.1.2.2` 最小验证只能作为 P2 门禁，本轮禁写 Java 代码 | 阶段性 | 适配说明 + Task 1 验收分层 + Task 2 |
| 区分「设计评审通过」与「工程实施验收通过」 | 阶段性 | 适配说明 + Task 1 + Task 11 语义审查 6 |

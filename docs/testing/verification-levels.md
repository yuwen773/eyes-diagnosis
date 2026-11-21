# 分级验证：什么时候跑什么

**默认跑 L1。** 改一两个文件就启动 `scripts/verify.sh`（全量）既慢又浪费，
真实后果不是「更安全」，而是人和 Agent 开始用「少跑」换速度——那才是真正降低门禁。

入口只有一个：`scripts/verify-fast.sh`。`scripts/verify.sh` 原样保留，行为不变，它是 L3。

---

## 1. 四个级别

| 级别 | 跑什么 | 典型耗时 | 什么时候用 |
|---|---|---|---|
| **L0** | git 差异摘要 + 受影响语言的编译/类型检查（`mvn test-compile`、`tsc -b`），**不执行任何用例** | 十几秒到 1 分钟（增量） | 只改了注释、文档、重命名；想先确认「它能不能编译」 |
| **L1**（默认） | 你显式点名的 Java 用例与/或 Vitest 文件 | 单个类 20–60s；web 单文件 5–15s | 绝大多数改动：改了一个类 / 一个组件，语义边界没跨出去 |
| **L2** | L1 + 一次性 MySQL 8 + Redis + Chroma（隔离端口） | 集成套件 1–5 分钟 | 改动涉及**数据库状态、schema/迁移、权限与角色、RAG 证据、Spring 上下文装配** |
| **L3** | `scripts/verify.sh`：全量 `mvn test` + MySQL 集成门禁（清单以脚本里的两遍 `-Dtest` 列表为准） | 10 分钟以上 | 准备合并、准备交付、或 L1/L2 结果无法解释时 |

`--level` 不变时也可以叠加：`--static` 在任何级别前加一段 L0，`--db` 把 L1 升成 L2。

```bash
scripts/verify-fast.sh --level L0
scripts/verify-fast.sh --java SessionMessageQueueTest
scripts/verify-fast.sh --java 'SessionMessageQueueTest#anEvictedWriteNeverReportsSuccess'
scripts/verify-fast.sh --web src/lib/agentStream.test.ts
scripts/verify-fast.sh --java FlywayMySqlIntegrationTest --db
scripts/verify-fast.sh --level L3
```

**L1/L2 必须显式给出目标。** 不给 `--java` / `--web` 会直接报用法错误退出（exit 2），
不会「猜着跑一个大概相关的」——猜出来的绿比红灯更危险。

---

## 2. 升级到 L2 的判据（命中任一条就升）

1. **数据库状态参与断言**：写库、事务、并发、锁、幂等、雪花 id、软删除。
2. **schema / Flyway 迁移**：新增或修改 `V*.sql`、改实体与列的对应关系。
3. **权限与角色**：`@AuthCheck`、资源归属（ownership）、管理员作用域、跨角色可见性。
4. **安全**：口令、会话、越权读取、上传归属校验。
5. **RAG 证据链**：片段来源、文档代次（`indexVersion`）、引用是否真的来自检索结果。
6. **医学边界**：严重度语义、措辞、拒识、置信度口径、复核冻结。
7. **跨模块契约**：改 `BaseResponse` 形状、SSE 事件名、protobuf 字段。
8. **Spring 装配**：新增 Bean、改 `application*.yml`、改 `@Configuration`。

反过来，**纯函数、纯计算、纯映射、单类内部逻辑**留在 L1。

---

## 3. 影响映射表（人可直接复核）

左侧是「你动了什么」，右侧是「至少跑什么」。表里的名字都是仓库里真实存在的用例。

| 改动位置 | 至少 L1 | 升级条件 |
|---|---|---|
| `web/src/pages/**`、`web/src/components/**` | 同目录 `*.test.tsx`，例如 `AgentPage.test.tsx`、`RecordsPage.test.tsx`、`RecordSheet.test.tsx`、`ChatInput.test.tsx` | 视觉/布局改动 **不因此升级**，但要按 `DESIGN.md` 跑**双主题人工验收**——脚本替代不了 |
| `web/src/lib/agentStream*`、SSE 消费 | `agentStream.test.ts`、`agentStream.hook.test.tsx` | 事件顺序/终态帧语义 → 加后端 `AgentControllerHistoryTest` |
| `web/src/lib/api*`、错误处理 | `api.auth.test.ts`、`faults.test.ts` | 后端响应形状变了 → L2 |
| Agent 流式输出（后端） | `controller/AgentControllerHistoryTest` | 终态帧落库、断连复用 → L2 |
| 工具执行与持久化 | `tools/DocumentSearchToolOwnershipTest`、`service/ChatMessageWriterTest` | 真的写库（`t_agent_message`、`t_agent_tool_audit`）→ L2 |
| 消息队列 / 恢复 | `queue/SessionMessageQueueTest`、`service/ChatHistoryServiceOwnershipTest`、`SessionPinExposureTest` | 涉及真实事务与租约 → L2 |
| RAG 检索与来源 | `rag/Bm25SegmenterTest`、`TextChunkerServiceTest`、`RrfFusionRankResetTest`、`tools/DocumentSearchToolOwnershipTest` | 连真实 Chroma / 改 embedding 口径 → L2（`--db` 会起 Chroma） |
| RAG 评估 | `rag/RAGEvaluationTest` | 阈值与题目集变更 → 记录前后数字，不只求绿 |
| Flyway 迁移 `src/main/resources/db/migration/V*.sql` | —— | **一律 L2**：`migration/FlywayMySqlIntegrationTest`（空库 migrate）。已应用过的迁移不可改，只能加新的 |
| 患者权限 / 医生复核 | `service/DiagnosisOwnershipTest`、`DiagnosisHumanReviewTest`、`DiagnosisHumanReviewAuditTest`、`DiagnosisEvidenceTest`、`DiagnosisAuthorFallbackTest` | 真实角色矩阵与跨用户可见性 → L2 |
| 认证与账号 | `security/PasswordServiceTest`、`controller/UserControllerOwnershipTest` | 会话存储、Redis → L2 |
| 新闻 / 管理端可见性 | `controller/News*Test`、`service/News*Test`、`AdminScopeVisibilityTest` | 发布生命周期涉及真实状态列 → L2 |
| 上传状态机 | `upload/state/UploadStateMachineTest`、`UploadStatusTest`、`UploadCompensationServiceTest` | 真实表 + 补偿任务 → L2 |
| 应用装配 / 配置 | `EyeDiagnosisApplicationTests`（`contextLoads`）——**它需要 DB + Redis + Chroma** | 直接 L2 |
| Python 算法服务 | `algorithm/` 下 `python -m pytest ... -m "not slow"`（CI 的 `python` job 同口径） | 含子进程/watchdog → 那几条在 Linux 上跑（CI `watchdog` job） |
| 工作树与运维脚本 `scripts/**` | `python -m unittest discover -s scripts/tests`；shell 改动先 `bash -n` | 会动 Docker 资源 → 只跑 dry-run，别在共享主机上做真实回收 |

> **协作 / 多 Agent 运行时**：本基线（`master`）还没有这套代码，对应用例随该功能所在分支落地。
> 落地后按「工具执行与持久化 + 消息队列/恢复」两行处理，且必须 L2。

---

## 4. 结果怎么读

脚本最后固定打印一行：

```
RESULT: PASS — L1
RESULT: FAIL — 未通过：java
RESULT: TIMEOUT — 未通过：java(TIMEOUT)
```

- **退出码**：`0` 通过、`1` 失败、`124` 超时、`2` 用法错误。超时**不是**通过——那个阶段什么都没证明。
- **日志**：`target/verify-fast/<run-id>/` 下按阶段分开存，报错时脚本会把尾部直接打到终端。
- **代码 SHA**：每行结果都带 `sha=<12 位>` 和 `tree=clean|dirty`，对照 CI 时不会有歧义。
- **没有测试算失败**：Java 侧 `check_surefire_result.py` 会核对本轮新生成的报告，覆盖
  「类名写错」「整类 `@Disabled`」「只有上一轮留下的陈旧 XML」三种伪装成功；
  Web 侧拦 `No test files found` 与「全部 skipped」。
- **环境没起来 ≠ 测试失败**：L2 的环境准备失败会单独报 `环境准备失败`，不要当成代码红灯去改代码。

## 5. 执行纪律（给 Agent 和人）

- **禁止**用「轮询日志」等结果：
  `until grep -q "EXIT=" log; do sleep 20; done` 这种写法分不清「还在跑」和「进程已经挂了」，
  而且它会一直占着会话。要等就盯**进程本身**（`scripts/verify-fast.sh` 里 `run_bounded` 就是这么做的）。
- **每个阶段都有上限**：默认 900s，`--timeout` 可调。超时先 TERM 再 KILL，
  只杀本次运行自己的进程树。
- **只清理自己创建的资源**：`--db` 起的容器名带本次 run id，退出即删；
  复用到 :8000 上已有的 Chroma 时不删它。
- **同一时间只允许一个 Agent 监督全量运行**。两个 Agent 同时跑 L3 会抢端口和 `.m2`、`target/`，
  得到的失败没有诊断价值。
- **不许为了变绿改业务代码**：测试红了先判断是「代码错」还是「用例错」还是「环境错」，
  三种结论要如实写出来。删测试、加 `@Disabled`、放宽断言都不算修好。

## 6. 不因分级而放松的东西

L1 省的是**范围**，不是**严格度**。以下与级别无关，永远不变：

- 权限、越权、安全相关断言不因「只跑一个类」而降级；
- 医学措辞、严重度语义、拒识口径、证据链要求；
- 已应用的 Flyway 迁移不可修改；
- 准备合并时必须有一次 L3（或等价的 CI 全绿），不能用一串 L1 拼出「已验证」。

## 7. 何时才考虑 CI 层优化

先按上面跑一段真实工作，观察三件事：L1 是否真的够用、L2 的启动开销是否可接受、
L3 是否仍然只在合并前触发。**没有这些数据之前不动 CI**；现有 CI 门禁一个也不删、不放宽。

## 8. 验收实测（2026-11-19，本机 Windows + Git Bash）

用三个真实场景量了一遍，基线 `a0efaf46`（`chore/verification-levels` 的起点）。
「启动开销」指与环境无关的固定成本，与用例本身的耗时分开记。

| 场景 | 命令 | 实际耗时 | 用例数 | 目标真的跑了吗 | 结果 |
|---|---|---|---|---|---|
| **React 组件** | `--web src/components/AgentComposer.test.tsx` | 3.9s（其中 Vite 启动约 2.5s） | 1 个文件 | 是（报告里列出文件与用例） | `PASS`，exit 0 |
| **Java 纯逻辑** | `--java SessionMessageQueueTest` | 17.6s（含首次全量 `test-compile`） | 2 个用例 | 是（Surefire 核对通过） | `PASS`，exit 0 |
| **落库集成（L2）** | `--java FlywayMySqlIntegrationTest --db` | 41.4s（MySQL+Redis 就绪约 20s，用例 19s） | 1 个用例 | 是（真实 MySQL 8.0.26 上 migrate） | `PASS`，exit 0 |
| 静态（L0） | `--level L0` | 14.2s | 0（只 `test-compile`） | — | `PASS`，exit 0 |

反例（这几条比正例更重要，全部按预期变红）：

| 场景 | 结果 |
|---|---|
| Java 类名写错（`--java NoSuchTestClass`） | `RESULT: FAIL`，exit 1，理由「本轮没有产生任何报告……测试没有执行」 |
| Web 文件不存在（`--web src/lib/no-such.test.ts`） | `RESULT: FAIL`，exit 1，`No test files found` |
| 超过阶段上限（`SessionMessageQueueTest --timeout 5`） | `RESULT: TIMEOUT`，exit 124，无残留 java 进程 |

没有重复跑的东西：本次验收没有触发 L3，也没有额外跑一遍 `mvn test`；L2 只跑了指定的
那一个集成类。`--db` 起的容器在退出后已全部删除（`docker ps -a` 无残留），
`:8000` 上已有的 Chroma 被复用而没有重建。

一次性的环境成本要单独看：新建工作树后 `web/` 需要 `npm ci`（本次 6 分 37 秒），
`mvn` 首次要把主代码与测试代码编译一遍；这两笔只在**新工作树**付一次，不是每次 L1 的成本。


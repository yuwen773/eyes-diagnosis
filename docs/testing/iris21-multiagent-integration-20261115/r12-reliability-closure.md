# Iris Multi-Agent R1.2 · 可靠性与审查收口

日期：2026-11-15。集成分支 `feat/iris21-multiagent-integration`，工作树
`D:\Work\code\eye-diagnosis\.claude\worktrees\iris21-multiagent`。
冻结 UI tag `iris-ui-v2.1-freeze-20261115`（`80f53f7f`）未被本轮触碰。

本轮承接 [R1 交付报告](report.md) 与 [R1.1 整改报告](r11-remediation.md)、
[第二轮独立审查](r11-second-review.md)。R1.1 的总体结论是 REQUEST_CHANGES，
唯一未闭环项是 **WP-C：历史 Docker 失败现场「协调器约 3 秒无任何 SQL」的因果**。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 七项历史 P2 | 逐项复核：修复提交、源码位置、确定性回归、第二轮结论均成立，**未发现仍存在的缺陷**；残余风险见 §1 表 |
| WP-C 产品时钟缺陷 | **已闭环**（交付分支提交 `8cc9f9fe`，对应整改分支的 `100a34fb`；领取/校验/续约统一到 MySQL `CURRENT_TIMESTAMP(6)`），含受控时差与快时钟竞争者负例 |
| WP-C 历史 Docker 静默的根因 | **机制已确立；历史现场本身判定为 UNEXPLAINED**（原始 general log 与数据库已被第一次审查删除，无法再取原始证据）。见 §2 |
| 本轮发现的夹具级假失败 | 已定性并修复（隔离库夹具未池化 → 池化，`464b9142`），并新增确定性因果回归 `GraphExecutionTest.blockedConnectionAcquisitionSilencesCoordinatorSqlAndExpiresTheLease` |
| Docker | **BLOCKED_ENV**（本机 Docker Desktop 的 WSL2 引擎失效，`scripts/verify.sh` 本机跑不完）。不是 PASS |
| 生产医疗协作 | 仍 **BLOCKED**，本轮不启用 |
| 推送/合并/部署 | 全程未推送、未合并到 `ui`/`master`、未部署 |
| 评审口径 | **不能因测试全绿自行认定 REVIEW_PASS**；见 §4.4 的独立审查结论 |

---

## 1. 任务一：七项历史 P2 的独立复核

方法：对每一项，独立定位**修复提交与当前源码位置**、**修复前的复现证据**、**修复后的确定性测试**、
**第二轮审查的结论**，并检查是否仍有残余风险。复核为只读核对，结论如下。

| 原 ID | 修复提交 / 当前源码位置 | 修复前复现证据 | 修复后确定性测试 | 第二轮审查结论 | 残余风险 |
|---|---|---|---|---|---|
| ST-1 / WP-A1 | `8e630be8`（交付分支上的 WP-A 提交；与 `fix/iris-r11-review-remediation` 的 `fe68aff2` 逐字节同树）；`src/main/java/com/csust/eyediagnosis/agent/ToolStepSink.java`（monitor 字段 32–36、`started` 48–56、`finished` 59–72、`emit` 98–110、`checkEmission` 112–121） | 旧实现忽略 `EmitResult`，并发帧被丢弃，审计缺 `two:succeeded` | `ToolStepConcurrencyTest.overlappingCompletionsDeliverEveryAuditedFrameInOrder`（latch 固定交叠窗口；断言 SSE 帧 == 审计列表 == `[one:running, two:running, one:succeeded, two:succeeded]`） | Standards PASS（0 确认发现）；Spec 未确认遗留 | 审计写入现在在 monitor 内（每次工具状态迁移都排在一次 DB insert 之后）：DB 卡住会卡住整条流；`ToolAuditService.record` 吞掉 RuntimeException，因此今天审计失败不会丢终态帧，但若 `Consumer` 抛异常，`pending` 已出队，该帧仍会丢 |
| ST-2 / WP-A2 | 同上（`closed`/`started` 守卫 48–56、pending 认领 59–72、`closePending` 先置 `closed` 79–87） | 旧实现出现 `running,cancelled,succeeded,failed` 四个终态 | `lateAndDuplicateResultsCannotAcquireASecondTerminalState`、`duplicateStartAndFinishCannotReopenACompletedCall`、`closeOwnsTheTerminalWhileAnIgnoringToolReturns`、`unexpectedSinkTerminationIsReportedAndCancellationRetainsAudit` | Standards PASS | 新 `started` 接受 `null` toolCallId（`ToolAuditService.record` 会丢弃 null id），此类调用会发出没有审计行的 SSE 帧；若 `emit` 在 `closePending` 内抛错，`pending.clear()` 与 `tryEmitComplete()` 被跳过（有意为之），flux 不会完成 |
| SP-2 / WP-A3 | `8e630be8`；`web/src/hooks/useCollaborationRun.ts`（repairs 计数 110、修复 135–144、阈值 180） | 旧实现对**每一帧**都 `repairs = 0`，心跳/重复事实会重置修复预算 | `useCollaborationRun.test.tsx`（232–253 两个负例 + 254–266 正例；fake timers，无随机 sleep） | Standards PASS | 「兼容事实」实现为「sequence 前进」而非语义兼容：任何更高 sequence 的帧（哪怕来自别的 actor）都会恢复修复预算；`previous` 从 `this.view.run!` 读取，无空值保护（目前靠 `refresh` 保证 run 存在） |
| SP-4 / WP-A4 | `8e630be8`；`src/main/java/com/csust/eyediagnosis/collaboration/CollaborationRunService.java`（调用点 134 subscribe / 144 read / 167 reauthorize，守卫 173–177 `requireLiveThread`） | 旧实现 `reauthorize`（以及 read/subscribe）不做会话存活检查 | `GraphExecutionTest.deletedChatClosesLiveDeliveryButPreservesAuditAndBackgroundRun`（446–477）：三个入口均 403、活动连接关闭、删除后无事件、后台运行仍 SUCCEEDED、审计保留 | Standards PASS | `snapshot(runId,userId)`（114）**未**设门禁：聊天删除后仍可读到状态/角色元数据与新游标；守卫要求恰好一条匹配的 `t_agent_session`（`size()!=1` 即拒）；「run 的 thread 属于另一个账号」是否应拒绝没有用例 |
| SP-1 / WP-B5 | `eb4dd48f`（交付分支上的 WP-B 提交；与 `d8fca767` 同树）；`web/src/components/agent/collaboration/collaborationLabels.ts`（`summaryLabel` 57–71：NONE 64 / SUPPLEMENT 66 / REWRITE 68 / 中性兜底 70） | 旧实现 `summary.startsWith("CRITIC_")` ⇒ SUPPLEMENT 也显示「要求修订」 | `collaborationLabels.test.ts`（4 条：NONE→「安全复核未提出异议」、REWRITE/SUPPLEMENT 各一条、未知 `CRITIC_FUTURE_ACTION`→中性标签） | Standards PASS | `summaryLabel` 不看发出者角色：任何 actor 发的 `CRITIC_REWRITE` 都渲染成「安全复核要求修订」；服务端新增 CRITIC_* 值会静默降级为中性标签 |
| SP-3 / WP-B6 | `eb4dd48f`；`web/src/pages/DoctorReviewsPage.tsx`（54–81：VISION + COMPLETED 才渲染 summary 56、字符串型 limitations 57–67、reanalysisSuggestion 68–79）；决定载荷在 `web/src/lib/reviewApi.ts` 148–158 | 旧组件不渲染任何 VISION 字段 | `DoctorReviewsPage.test.tsx`（35–109）：摘要/限制/REVIEW_QUALITY 可见、`hiddenReasoning` 缺席、具体异议可见、`decide` 收到冻结的 detail 对象 + APPROVED + 备注；后端 `DoctorReviewApiTest`（13 个方法）独立覆盖授权与版本失效 | Standards PASS | **比报告措辞弱**：该用例不断言 HTTP body（版本/摘要在 `reviewApi.decide` 内部附带），且「授权」不是前端属性、也不由该用例断言；`result.summary` 是模型自由文本（schema 里就是 `text`，只有 `reanalysisSuggestion` 受枚举约束），医生端措辞质量取决于提示词而非白名单；「隐藏推理缺席」是弱守卫 |
| SP-5 / WP-B7 | `eb4dd48f`；`src/main/java/com/csust/eyediagnosis/agent/DiagnosisAgent.java`（126–127 `resolveOwnedImageId`，280–290 输出 key）+ `agent/service/AgentImageUploadService.java`（103–114 host/key 相等、`agent-chat/{userId}/…\.(png\|jpg)`、登记行、userId、`UploadStatus.activeCodes()`）；工具侧复检 `agent/tools/UserBoundEyeImageAnalyzerTool.java` 34–37 | 原实现把原始 URL 直接送进模型 | `DiagnosisAgentImageReferenceTest`（78–100）：真实上传服务生成 PNG URL，经真实模型边界断言模型只见 key 且不含 `https://`，再由真实 user-bound 工具读 COS；跨用户/外站/缺失登记/删除/`?signature=`/`user@`/`:444` 端口七类负例在模型与 COS 读之前被拒 | Standards PASS | `resolveOwnedImageId` 只作用于 `DiagnosisAgent.stream`（目前 `src/main/java` 中唯一产出 `<image-analysis>` 的地方），保证是局部的；host 比较是精确字符串（`cosClientConfig.getHost() + "/" + key`），host 形式漂移（尾斜杠、CDN 别名）会打断上传；端口检查完全依赖后续的精确字符串相等 |

**复核发现的两处报告口径偏差（已记录，未改产品代码）**

1. **提交 SHA 记在整改分支上**：R1.1 报告里的 `fe68aff2 / d8fca767 / 100a34fb / 747656f / 2dc6820f` 只存在于
   `fix/iris-r11-review-remediation`；**交付分支上是逐字节同树的改写提交** `8e630be8`（WP-A）、`eb4dd48f`（WP-B）、
   `8cc9f9fe`（WP-C）、`c2815fcd`（快时钟负例 + 计数更新）、`e4e13aad`（浏览器回归适配）。内容主张成立，
   只是「SHA 落在哪个分支」的说法要改。
2. **SP-1 的文件路径被写短了**：实际是 `web/src/components/agent/collaboration/collaborationLabels.ts`
   （测试同目录）。

> 复核口径说明：以上是**独立核对代码与测试是否成立**，不是「因为测试通过所以缺陷不存在」。
> 复核过程中未发现任何一项的修复被回退、断言被放宽或用例被删除；也未发现任何一项仍存在的缺陷。


---

## 2. 任务二：Graph 历史静默归因

### 2.1 现象与现存证据

R1.1 报告记录的历史现象：MySQL general log 显示，用例把 `leaseUntil` 手改为 `NOW()+3s` 之后，
**协调器线程再无任何 SQL**；3 秒后租约自然过期，`checkLease` 抛 `Stop`，用例的有界等待超时。

**原始证据已不可恢复**：本轮逐个检查了仓库内所有 `general_log.CSV`，**全部为 0 字节**——
`realtime-collaboration-ui/target/mysql-task05/mysql/`、`realtime-graph-runtime/target/task02-mysql/data/mysql/`、
`realtime-model-evaluation/target/task06-check-mysql/data/mysql/` 与 `task06-live-mysql/data/mysql/`、
`realtime-safety-release/target/task07-mysql/data/mysql/`、
`realtime-product-acceptance/target/product-mysql/data/mysql/` 各 1 个，
以及 `iris-r11-remediation/target/r11-runtime/mysql/mysql/`（该 MySQL 数据目录已在本轮按 §3 的
合法清理方案删除，删除前该文件同为 0 字节）；历史 Docker 数据库目录本身也已被第一次审查删除。
因此「历史现场究竟发生了什么」**不能再用原始证据回答**。

### 2.2 逐个候选成因的排除（基于当前源码，不是推测）

| 候选角度 | 结论 | 依据 |
|---|---|---|
| 调度器与 Executor 生命周期 | **排除** | 租约续约不是独立任务：`PatientDraftCoordinator.executeGraph()`（`src/main/java/com/csust/eyediagnosis/patientdraft/PatientDraftCoordinator.java:252`）的续约循环就写在**调用线程**上（`:269–279`：`while (!stream.isDone()) { guarded(...); if (clock.millis() >= renewAt) { guarded(... UPDATE leaseUntil ...); } stream.get(20ms); }`），而 `coordinator.run(taskId)` 由 `CollaborationRunService` 的单线程 worker（线程名 `collaboration-coordinator`）同步调用。不存在可被取消或漏调度的「心跳任务」 |
| 心跳任务被取消 / 遗漏调度 | **排除** | 同上：没有独立心跳线程。取消路径是 `stream.cancel(true)` + `active.forEach(f -> f.future.cancel(true))`，发生在 `executeGraph()` 的 `finally` 里（`:297–300`），即整轮已结束后；它无法让仍在运行的续约循环「静默但不报错」 |
| 线程池 / 锁竞争 / 事务等待 | **排除（可证伪）** | `guarded(...)`（`:721–736`）内先取连接、再按 task → run 顺序 `SELECT … FOR UPDATE`；分支线程在等外部模型时并不持有这两把锁（模型调用在事务之外）。而**锁等待会照常出现在 general log 里**（语句已送达服务端，只是等锁）——§2.5 用实验证明了这一点。因此「日志里一条 SQL 都没有」与「锁等待」不相容 |
| 测试夹具隔离与共享状态 | **部分排除，且是真实成因之一** | 隔离库夹具用**未池化** `DriverManagerDataSource`，协调器每 20 ms 开一个事务 ⇒ 每个事务新建一条物理连接（含 TLS 握手）。实测一轮 `GraphExecutionTest` 新建 3 718–4 358 条物理连接（池化后 50–55 条，§2.4(a)）。**线程栈实证**：协调器线程确实卡在 `DriverManagerDataSource.getConnectionFromDriverManager` 的 TLS 握手里，位置正是租约检查那次 `guarded(...)`（§2.4(d)）；连接建立成为瓶颈时，续约就会错过 1 s 节奏 |
| JVM / MySQL 时间源 | **确认为独立的产品缺陷（已修）**，同时也是一条**夹具级风险** | ① 产品侧：`recoverPending()` 用 MySQL `CURRENT_TIMESTAMP` 判过期，而领取/校验/续约用执行器 Java Clock，统一时区不能统一墙钟 → `100a34fb` 已统一到数据库时钟（交付分支上对应提交 `8cc9f9fe`，两棵树逐字节相同），并以 ±6 秒受控偏差与快 20 秒竞争者负例锁死。② 夹具侧：MySQL 会话时区与 JVM 默认时区不一致时，同一条 `CURRENT_TIMESTAMP(6)` 会被驱动解释成相差 8 小时的瞬间——§2.7 有实测真值表 |
| 整类测试与单方法执行差异 | **确认为放大因子** | 单方法运行时负载低；整类运行时连接建立总量高一个数量级，续约更容易错过节奏。修复前的实测：单方法 5/5 通过、整类不稳定 |

### 2.3 机制的确立：确定性同步测试

新增回归 `GraphExecutionTest.blockedConnectionAcquisitionSilencesCoordinatorSqlAndExpiresTheLease`
（`src/test/java/com/csust/eyediagnosis/collaboration/GraphExecutionTest.java`）：

- 用一个可注入的 `StallingDataSource` 包住池化数据源，让**指定线程**（`collaboration-coordinator`）
  的连接获取阻塞——这正是「TLS 握手卡住」的形状；
- 断言一：阻塞期间该线程**一条 SQL 都没发出**（按线程计数的语句计数器为 0）——复现历史「约 3 秒无任何 SQL」的签名；
- 断言二：租约**没有被续约**（`leaseUntil` 从未被推回 `NOW()+10s`），并按**数据库时钟**过期；
- 断言三：执行器被围栏，运行**没有**变成 SUCCEEDED——因为 `PatientDraftCoordinator.restrict()`
  在 `checkLease` 抛 `Stop` 时**提前返回**（`:745` `catch (Stop stale) { return; }`），
  围栏掉的执行器**不能**写下终态；`t_patient_draft_run` 仍是 `RUNNING`，由恢复扫描器接管。

因为停顿是注入的，整条因果链是确定性的，不依赖任何机器负载或时间巧合，也**没有放宽任何断言、
没有删任何用例、没有延长任何超时**。

> **一处自我修正（`5d7afd11`）**：这条回归的第一版把语句计数器只代理在
> `java.sql.Connection` 的 `execute/executeQuery/executeUpdate/prepareCall` 上。
> 但 Spring 的 `JdbcTemplate` 是**先在连接上 `prepareStatement`、再在语句对象上执行**，
> 那几个钩子从来不会被触发——于是「阻塞期间该线程一条 SQL 都没发出」当时是一条**空断言**
> （计数器恒为 0，前后相等自然成立）。现在改为**同时代理语句对象**（按返回对象的实际类型选接口），
> 在语句真正执行时计数，并加了一道自检：**阻塞发生前该线程的计数必须已经大于 0**，
> 否则直接失败。这样「计数没有增长」才只能是「确实没有发出 SQL」，
> 而不可能是「观察者根本没在工作」。单条与整类复跑均通过（1/1、37/37）。

实测：`GraphExecutionTest` 整类 **37/37 PASS**（含本条），单条 1/1 PASS。

> 写这条用例时还发现一个**夹具构造陷阱**，值得记下来：事件写入器 `CollaborationEvents` 与
> `CollaborationRunService` 必须共用**同一个**数据源。否则 `append()` 会通过**另一条连接**去读
> `t_agent_collab_run`，而那条连接不在调用方事务里，于是它会等自己所在逻辑事务尚未提交的
> 那一行——现场是 `SELECT runId,seq,roleStates FROM t_agent_collab_run WHERE taskId=? FOR UPDATE`
> 报 `Lock wait timeout exceeded`，阻塞者与等待者的 `information_schema.data_locks` 完全对应
> （同一 taskId、同一 runId）。这是**测试构造问题，不是产品缺陷**：生产里两者共用同一个 Spring
> `DataSource`。顺带印证了一条本报告用于排除候选的判据——**锁等待在服务端是可见的**
> （`data_locks` 明确显示谁持有、谁等待），因此「日志里一条 SQL 都没有」确实排除锁等待。

### 2.4 复现实验（PR #68 原线，pre-fix 夹具 + general log + 线程栈）

**目的**：在**修复前**的夹具上重跑整类 `GraphExecutionTest`，同时打开 MySQL general log 并周期抓
线程栈，用来（a）量化未池化夹具的物理连接开销，（b）观察「协调器线程无 SQL」这一签名是否出现。

**环境与方法**（脚本不入库，产物落在 `target/`，gitignored）：

- 工作树：PR #68 原线工作树 `realtime-product-acceptance`，分支 `fix/graph-lease-heartbeat-flake`
  （基点 `10173ae9`）；**不是** PR #68 的原开发分支 `codex/realtime-product-acceptance`。
- 夹具：把 `GraphExecutionTest` / `CollaborationRunTest` 两个隔离库夹具**临时**回退到 `10173ae9`
  的未池化 `DriverManagerDataSource`（EXIT trap 复原，脚本结束后 `git status` 确认复原）。
- 服务：本机原生 MySQL 8.0.26（3307）；`SET GLOBAL general_log=1` 写文件日志；
  每 3 s 对 surefire JVM 抓一次 `jstack`（共 14 份，落在 `target/graph-jstack/`）。
- 计数：MySQL **全局**状态 `Connections` 的前后差值 = 该次运行的**物理连接数**。

> 测量口径修正（第一次测量踩过的坑）：`Com_connect` 是**会话级**变量，用它统计物理连接数会得到 0；
> 正确的是全局状态 `Connections`。此外 general log 的列分隔是 `时间 \t "<连接号> <命令>" \t 参数`——
> 连接号与命令之间是**空格**而不是制表符，解析器若按 4 列切分会静默丢行（第一次解析因此得到「0 个连接」）。

**结果**：

**(a) 物理连接量。** pre-fix 夹具整类跑一轮新建 **4 358** 条物理连接；另一轮带 general log 的复跑是
**3 718** 条（同一份日志里能数到 **3 722** 个 `Connect` 行，差 4 条来自测量窗口边界：状态计数在连接
关闭前后取样，日志按行计数）。对照池化夹具（`0c3d0aec` 之后）同口径是 **50–55** 条。数量级差 ≈ 70 倍。

**(b) pre-fix 夹具上整类结果不稳定。** 一轮 **32/32 PASS**（74.60 s，带 general log 与线程栈）；
另一轮 32 条里 **2 F + 11 E**（33.42 s）。
后一轮的失败链与历史 Docker 失败**签名不同**，必须分开说：首发故障是**夹具清理阶段的外键违规**
（`DELETE FROM t_controlled_reference` 被 `t_controlled_reference_chunk` 的外键挡住），
夹具在这一步中途放弃 ⇒ `t_user` / `t_agent_session` 没有重新播种 ⇒ 后续用例 DuplicateKey ⇒
`runs.create(...)` 抛 `Fault ACCESS_DENIED`。
**该级联的近因未定位**（候选：上一条用例的后台线程仍在写行；未池化夹具使连接建立变慢、放大这个窗口），
按口径只记录事实与候选，不写成结论。
**关键区分**：历史 Docker 失败的签名是「协调器约 3 秒无 SQL → 租约过期 → `STALE_EXECUTOR`」，
本机 pre-fix 这一次**不是**这个签名，因此**不能**拿它当作历史现场的复现。

**(c) general log 的签名检索。** 修正解析器后，在 45 051 行日志上得到：

- 打开的连接 **3 722** 个，其中 **3 722** 个都至少发出过一条语句；
- **「`Connect` 之后 ≥ 1 s 才发出第一条语句」的连接：0 个**；
- 「同一条连接上两条语句之间静默 ≥ 1 s」：**1 处**，且就是 §2.5 那对人为制造的锁等待会话
  （conn 107725 / 107726），与协调器无关。

⇒ 本机这一轮 pre-fix 运行**没有**出现「连接已建立却迟迟不发 SQL」的签名（至少没有持续 ≥ 1 s 的）。

**(d) 线程栈：协调器确实会卡在物理连接建立里。** 14 份 jstack 中有 **3 份**抓到
`collaboration-coordinator` 线程：

| 抓取 | 线程状态 | 关键栈帧（自上而下） |
|---|---|---|
| `dump-17` | RUNNABLE | `sun.security.ec.ECOperations.multiply`（ECDHE 点乘）→ … → `DriverManager.getConnection` → `DriverManagerDataSource.getConnectionFromDriverManager` → `PatientDraftCoordinator.guarded(PatientDraftCoordinator.java:721)` ← `executeGraph(:271)` ← `run(:89)` ← `CollaborationRunService.lambda$kick$7(:259)` |
| `dump-18` | RUNNABLE | `sun.nio.ch.SocketDispatcher.write0` → `NativeProtocol.negotiateSSLConnection` → `DriverManager.getConnection` → `DriverManagerDataSource.getConnectionFromDriverManager` → `guarded(:721)` ← `executeGraph(:271)` |
| `dump-19` | TIMED_WAITING | `CompletableFuture.timedGet` → `executeGraph(:279)` |

- 栈帧里的 `:721` 是 `guarded(...)` 方法体的**第一条可执行行**（方法声明在 PR #68 原线的第 720 行）；
  `:271` 与 `:279` 是 `executeGraph` 里的调用点行号。这三个行号在 PR #68 原线与本集成分支上
  **完全一致**——两边的 `PatientDraftCoordinator.java` 只在租约列的时钟写法上不同
  （`:274`、`:419–436`，即 WP-C 修复 `8cc9f9fe`），**续约循环的结构与行号未动**。
- `executeGraph(:271)` 是源码里续约循环的**第一次 `guarded(taskId, lease, () -> null)`**（租约检查），
  `guarded` 内的 `transactions.execute(...)` 要**取一条连接**才能开始事务；
  `executeGraph(:279)` 正是 `stream.get(20, TimeUnit.MILLISECONDS)`——dump-19 的行号与源码**逐行对上**，
  确认抓到的是本仓库这一版 `PatientDraftCoordinator`。
- 于是：在 **pre-fix 未池化夹具**上，协调器线程**确实会被卡在物理连接建立（TLS 握手）里**，
  卡住的位置就是**租约检查那次 `guarded(...)` 调用**；这段窗口内协调器**一条 SQL 都发不出去**。
  这与 §2.3 的确定性回归所注入的阻塞点**属于同一类**。

**(e) 一条必须作废的数字。** 早前记录过的「组合运行 64 条物理连接」**无效**：那次运行发生在复原脚本
已经先把池化夹具装回去之后（`target/prefix-combo-prefix.log` 里能读到
`HikariDataSource -- collaboration-run-test - Starting...`）。该数字**不得引用**。
`464b9142` 提交信息里的 ≈2 790 / 6 417 是**同机早前一次**（修复当时）的测量，与本轮 §(a) 的
4 358 / 3 718 属不同轮次，引用时必须写明出处。

### 2.5 排除实验：锁等待会出现在 general log 里

**目的**：验证 §2.2 里那条排除判据——「日志里一条 SQL 都没有」与「锁等待」不相容。

**方法**：两个 MySQL 会话打同一张表的一行：会话 1 `SELECT … FOR UPDATE` 后 `DO SLEEP(8)` 持锁；
会话 2 `innodb_lock_wait_timeout=4` 去等同一行。general log 记录两边。

**结果**：两条会话在 general log 里的原文（时间戳取自日志自身）：

| 连接 | 时间（UTC） | 记录 |
|---|---|---|
| 107725（持锁） | 12:09:10.166100Z | `Connect` |
| | 12:09:10.166278Z | `select @@version_comment limit 1` |
| | 12:09:10.166433Z | `START TRANSACTION` |
| | 12:09:10.166576Z | `SELECT * FROM lockwait_probe.t WHERE id=1 FOR UPDATE` |
| | 12:09:10.168206Z | `DO SLEEP(8)` |
| | 12:09:18.170229Z | `COMMIT` |
| | 12:09:18.170605Z | `Quit` |
| 107726（等待） | 12:09:12.281785Z | `Connect` |
| | 12:09:12.281958Z | `select @@version_comment limit 1` |
| | 12:09:12.282112Z | `SET SESSION innodb_lock_wait_timeout=4` |
| | 12:09:12.283195Z | `SELECT * FROM lockwait_probe.t WHERE id=1 FOR UPDATE` |
| | 12:09:17.310954Z | `Quit`（等满 4.03 s 后按 `innodb_lock_wait_timeout` 失败，服务端报 `ERROR 1205 Lock wait timeout exceeded`） |

判据成立：等待方的**阻塞语句本身已经写进 general log**（12:09:12.283195Z），
其后 4.03 s 的等待表现为「这条语句」与「Quit」之间的静默，而**不是**「没有任何 SQL」。
⇒「日志里一条 SQL 都没有」与「锁等待」**不相容**，§2.2 里那条排除成立。
（同一份日志里那唯一一处 8.002 s 的语句间静默，就是 conn 107725 的 `DO SLEEP(8)` 与等待方
12:09:18 才解锁的组合。）

### 2.6 结论

**机制已确立**：只要协调器线程在**发出语句之前**被连接获取卡住，就会同时产生
「协调器无任何 SQL」「续约错过节奏」「租约过期」「执行器被围栏」四个现象——
与历史记录逐条吻合。三条互相独立的证据支撑这一点：

1. **确定性同步测试**（§2.3）：把阻塞注入到连接获取上，整条链不依赖机器负载或时间巧合；
2. **真实线程栈**（§2.4(d)）：在 pre-fix 未池化夹具上，协调器线程**确实**被卡在
   `DriverManagerDataSource.getConnectionFromDriverManager` 的 TLS 握手里，位置正是续约循环里
   租约检查那次 `guarded(...)`；这段窗口内它一条 SQL 都发不出去；
3. **排除实验**（§2.5）：锁等待会**照常出现在 general log 里**，因此「日志里一条 SQL 都没有」
   排除锁等待这一类成因。

**历史 Docker 现场本身的根因判定为 UNEXPLAINED**：该现场的数据库与 general log 已被删除，
无法再取原始证据；本轮的复现与取证是在**另一个现场**（本机原生 MySQL 8.0.26）取得的，
按要求**不以推测替代结论**。具体地说，以下三点**仍然无法回答**：

- 当时的协调器线程究竟停在哪个栈帧（栈没了）；
- 当时的静默持续了多久、期间是否发过任何 SQL（general log 没了）；
- 当时的连接建立是被什么拖慢的（数据库与容器现场都没了）。

需要说清楚的是：§2.4(d) 证明的是**机制类**（「未池化夹具 + 连接建立成为瓶颈 ⇒ 协调器被卡在
连接获取 ⇒ 无 SQL ⇒ 租约过期」）在本机**成立**，且 pre-fix 夹具**正是**这种形状；但历史现场
是否就是这一形状，因证据缺失**不能断言**。因此结论写成「机制已确立 + 历史现场 UNEXPLAINED」，
而不是「历史根因已定位」。

**闭环所需步骤（若要真正结案）**：在同一 Docker 场景重跑一次 `GraphExecutionTest` 整类，
并同时打开 MySQL general log 与周期线程栈（脚本：`scripts/verify.sh` 第三遍已具备该组合），
即可在同一现场同时拿到「Connect 而无 Query」与协调器线程栈。本轮的实验脚本已经跑通，
只差一个能用的 Docker 引擎。

### 2.7 本轮两条环境干扰（均已定性，非产品缺陷）

本轮集成候选的三遍验证出现过两次失败，**都不是产品回归**，逐条留证：

1. **pass 1 的 `FullApplicationAcceptanceTest` 登录失败**：宿主 Redis 进程在运行期间退出，
   `RedisSessionRepository.save` 抛 `RedisConnectionFailureException`（surefire `system-out` 中可见），
   Spring Session 保存失败 → 登录接口返回非 0 → 用例断言「患者登录应成功」为 false。
   重启 Redis 后复跑通过。
2. **pass 3 的 3 条失败**（`databaseLeaseSurvivesHostClockSkew(-6)`、`(6)`、
   `processDeathRestoresOnlyCommittedNodesAndPreservesBudgets[JOIN:DEADLINE]`）：
   同期另有一个三遍验证进程在退出时把 MySQL 的 `time_zone` 还原为 `SYSTEM`，
   而当前进程的 JVM 被 `-Duser.timezone=UTC` 固定为 UTC。实测真值表（Connector/J 9.4.0）：

   | MySQL 会话时区 | JVM 默认时区 | 实测偏差（宿主 − 数据库） |
   |---|---|---|
   | `+00:00` | UTC | ≈ 0（一致） |
   | `+00:00` | +08:00 | +28 800 000 ms |
   | `SYSTEM`（=+08:00） | UTC | **−28 800 001 ms** ← 与失败现场实测的 −28 806 000 / −28 794 000 ms 完全吻合 |
   | `SYSTEM` | +08:00 | ≈ 0（一致） |

   即失败现场正是「服务端 SYSTEM + JVM UTC」组合。**教训**：`scripts/verify.sh` 第三遍的
   `-Duser.timezone=UTC` 与服务端 `time_zone` 必须成对设置，且**同一台机器上不得并发跑两套
   三遍验证**（任一进程退出时的还原会污染另一进程）。

---

## 3. 任务三：Docker 环境阻断与遗留目录

| 项 | 事实 |
|---|---|
| Docker 状态 | `docker info` 返回 `Error response from daemon: Docker Desktop is unable to start`；WSL2 引擎失效，重启 WSL 需要管理员权限，本会话没有 |
| `scripts/verify.sh` | **BLOCKED_ENV**——它在创建第一个 Redis 容器时就报错退出。**不记 PASS** |
| 本机替代 | MySQL 8.0.26（Windows 服务 `MySQL80`，端口 3307，与 `mysql:8.0.26` 镜像同引擎版本）+ 原生 Redis（端口 36419）+ 最小 Chroma HTTP 夹具（只应答 `ChromaVectorStore` 初始化时的那一次 collection GET，其余 501；**不做向量检索、不调嵌入，不等于真实 Chroma/RAG 验收**） |
| 遗留目录 | `iris-r11-remediation/target/r11-runtime/mysql`（一次性 MySQL 数据目录，247 MB，gitignored）。本轮用普通 `rm -rf`（非强制、未绕过任何策略）删除，退出码 0；该目录不属于交付分支，也不含任何证据文件（其中的 `general_log.CSV` 本就是 0 字节）。剩余 `target/r11-runtime` 41 MB 为日志与 surefire 报告，保留未动 |

**合法且安全的清理方案（备查，本轮只执行了第一条）**

1. `rm -rf <worktree>/target/r11-runtime/mysql`——一次性 MySQL 数据目录，纯临时产物，gitignored；
   本轮已执行，退出码 0。
2. `rm -rf <worktree>/target`——整个构建输出目录，含 surefire 报告与日志，gitignored。
3. `git worktree remove <worktree>`——连同整个 R1.1 整改工作树一起回收（会先删除该工作树的
   `target/`，无需单独处理）。
4. **不要**做的事：不要在 MySQL 服务仍在使用某个数据目录时删除它；不要为了腾空间去删
   `iris-r11-remediation` 工作树里尚未提交的证据文件（该工作树当前是干净的，`git status` 为空）。

---

## 4. 任务四：最终收口

### 4.1 验证矩阵（本轮实际结果）

| 门禁 | 运行方式 | 结果 | 边界 |
|---|---|---|---|
| Java 隔离库（12 套件同 JVM） | `scripts/verify.sh` 第三遍的等价替代，本机原生 MySQL 8.0.26 + 原生 Redis | **PASS** — `Tests run: 302, Failures: 0, Errors: 0, Skipped: 0`（含 `GraphExecutionTest` 37 条，其中新增第 37 条为确定性因果回归） | 不是 Docker 容器运行；`scripts/verify.sh` 本机 BLOCKED_ENV |
| Java 全量单元 + `contextLoads` + 完整应用级验收 | 第一遍等价替代 | **PASS** — `Tests run: 611, Failures: 0, Errors: 0, Skipped: 302`（`FullApplicationAcceptanceTest` 7/7 在其中） | 隔离库套件在此遍按设计跳过 |
| CI `backend-unit` job 的本地等价跑法 | `mvn test`（不带 `-Dtest` 过滤）+ 只设 `SPRING_PROFILES_ACTIVE=ci`、不给任何隔离库 URL，随后跑 `backend-unit` 门禁 | **PASS** — `Tests run: 618, Failures: 0, Errors: 0, Skipped: 309`（302 + 7，按设计全部 skipped）；门禁 `skip gate passed` | 与 CI job 同样的命令与环境变量集合；容器换成原生服务（§3） |
| Java MySQL 集成门禁 | 第二遍等价替代 | **PASS** — 7/7 | — |
| 完整三遍 | 连续执行 | 全绿（pass1 611 / pass2 7/7 / pass3 302），在交付 SHA `5d7afd11` 上复跑 | — |
| pass 3 等价组合单独复跑 | 12 套件同 JVM | 2/2 PASS（302/302） | — |
| 精确计数门禁 · `graph-execution` | `python scripts/check_surefire_skips.py target/surefire-reports-pass3 graph-execution` | **PASS** — `ok: …GraphExecutionTest (37 cases, 0 skipped)` + `skip gate passed: no unexpected skipped or dropped tests` | Graph 用例数 36 → **37**（同步更新，**不是放宽**：该门禁要求这些用例必须全部跑到） |
| 精确计数门禁 · `backend-unit` | 按 CI `backend-unit` job 的口径本地复跑：`mvn test`（**不**带 `-Dtest` 过滤）+ 只设 `SPRING_PROFILES_ACTIVE=ci`，**不**给任何隔离库 URL，然后 `python scripts/check_surefire_skips.py target/surefire-reports backend-unit` | **PASS** — `skip gate passed` | 本地替代：MySQL/Redis/Chroma 用本机原生服务替掉一次性容器（§3） |
| 新增因果回归单条 | `GraphExecutionTest#blockedConnectionAcquisitionSilencesCoordinatorSqlAndExpiresTheLease` | **PASS** | — |
| `GraphExecutionTest` 整类 | 含新回归 | **PASS** — 37/37 | — |
| 前端 Vitest / typecheck / ESLint / build | R1.1 候选上已跑通，本轮未改前端 | 66 文件 636/636、全 PASS | 本轮前端零改动 |
| 协作浏览器 + 双主题冻结布局 | R1.1 候选 | 31/31 PASS | 合成 HTTP/SSE |
| 默认关闭浏览器 / 真实 Java 浏览器 | R1.1 候选 | 1/1、5/5 PASS | — |
| Hosted CI | PR #68 原线 `codex/realtime-product-acceptance` @ `10173ae9` | 20/20 job SUCCESS（连续 12 次全绿） | **本轮所有提交均未推送，因此修复本身没有 hosted CI 证据** |

### 4.2 UI 冻结与生产门禁

- 冻结 UI tag `iris-ui-v2.1-freeze-20261115`（`80f53f7f`）**未被本轮触碰**；本轮改动只落在
  `src/test/java/.../GraphExecutionTest.java`、`scripts/check_surefire_skips.py` 与
  `docs/testing/iris21-multiagent-integration-20261115/` 下的报告。
- `web/` 目录本轮**零改动**：`git diff --stat 0c3d0aec..5d7afd11 -- web/` 为空，
  且 `git diff origin/ui...58955939 -- web/` 与 `git diff origin/ui...HEAD -- web/` 逐字节相同
  （65 文件 / +7866 / −51）。
- **生产医疗协作仍为 BLOCKED**：全部 `eye-diagnosis.collaboration.*` 默认 `false`；本轮不部署、
  不启用、不改任何开关。
- 本轮**未推送、未合并到 `ui`/`master`、未部署**；PR #68 原开发分支
  `codex/realtime-product-acceptance` 未被改动。

### 4.3 剩余 P0/P1/P2 与未闭环项

| 级别 | 项 | 状态 |
|---|---|---|
| P0 | 无已确认项 | 本轮未证实新增，但按既定口径不能据此断言不存在 |
| P1 | 无已确认项 | 同上 |
| P2（已关闭） | 七项历史 P2（§1） | 逐项复核成立，修复与回归均在树内 |
| P2（已关闭） | WP-C 产品时钟缺陷 | `8cc9f9fe` + 受控时差与快时钟负例 |
| P2（已关闭） | 隔离库夹具未池化 | `464b9142` → `0c3d0aec`，并新增确定性因果回归（`ae78593f`，语句计数自检修正 `5d7afd11`） |
| **未闭环（不是缺陷，是证据边界）** | **历史 Docker 现场「约 3 秒无 SQL」的确切成因** | **UNEXPLAINED**：原始 general log 与数据库已被第一次审查删除。机制已确立并有确定性回归，但**历史现场本身不可再取证**（§2） |
| P2（夹具脆弱点） | 隔离库套件的时区耦合 | `scripts/verify.sh` 第三遍把 JVM 与服务端时区成对固定为 UTC；其余列仍未统一走 SQL 侧时钟 |
| P2（覆盖缺口） | `run.restricted` 事件缺完整应用级用例 | 代码路径与 `run.failed` 共用；隔离库套件覆盖停止语义，完整应用级未单独构造 RESTRICTED 输入 |
| 环境 | Docker Desktop 失效 | `scripts/verify.sh` 本机 BLOCKED_ENV（§3） |

### 4.4 独立审查结论

__REVIEW_VERDICT__


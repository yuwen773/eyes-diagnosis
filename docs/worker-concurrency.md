# 工单 16：任务竞争与技术失败恢复

## 实现

Job 保留不可变的**输入 checkpoint**。执行结果和下一续跑 token 只写入
UploadInput 与后续 Job；重复投递不能用上次执行的输出误执行下一节点。
领取时丢弃终态、人工等待或 checkpoint 已过时的任务，不改变工作流版本或结果。
领取到行锁后重新读取 MySQL 时间，再授予租约，避免锁等待消耗新租约。

提交仍沿用同一个持久化事务：锁定 Job/Workflow，校验有效租约、token、
leaseVersion 和 workflowVersion，然后提交 checkpoint、推理包、事件和续跑 Job。
失效执行者的成功结果和失败回调都无业务效果。图继续决定临床路由，Worker
只管理执行权、技术重试和持久提交；模型和检索调用期间没有长期数据库事务。

检索工具异常进入技术重试；成功检索但没有合格证据仍走原有证据不足路径。
解释模型的连接/读取错误、429、5xx 和总调用期限超时同样重试，耗尽后为
FAILED / EXECUTION_FAILED。缺配置、过大响应、无效响应仍扣留解释。
HTTP 提供商错误只记录固定错误信息，不记录原始异常或响应。

## 可复现验证

在 PowerShell 7 中从 `algorithm` 运行，用环境变量提供本地 MySQL 管理连接：

```powershell
$env:WORKER_TEST_MYSQL_ADMIN_URL='mysql+pymysql://<user>:<password>@127.0.0.1:3307/'
& .venv-baseline/Scripts/python.exe -m web.verify_worker_concurrency --output-dir ../.scratch/python-agent-migration/evidence/issue16/reproduction
```

运行器仅连接本机，创建随机 `eye_worker_issue16_` 测试库，使用指定 JDK 21
运行独立 Flyway migrate/validate，再执行真实 Worker 进程测试。不会对业务库
执行迁移，不运行 ORM 建表，也不删除数据库。V19 依赖的前 Flyway 知识库表
从原 schema.sql 只提取其 CREATE 语句初始化；不执行该文件的 USE/ALTER/DROP。

如已有隔离且完成迁移的测试库，可设置 `WORKER_TEST_MYSQL_URL` 后直接运行：

```powershell
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_worker_concurrency.py -q
```

测试从真实任务 HTTP 路由创建/查询任务，在独立进程中运行生产 Worker 和图，
用有界的慢调用/故障适配器控制外部算法、检索，使用 MySQL 故障注入制造租约、
token、版本失效并核对持久效果。故障入口只在测试中，生产 API 没有故障注入路由。

覆盖：

- 同一 Job 重复投递，终态不重开、已提交分段不重跑。
- 两个 OS 执行者竞争同一任务，MySQL 时间授予租约。
- 模型/工具慢调用期间，其他事务可 NOWAIT 锁定任务与工作流行。
- 过期执行者返回成功或异常，均不能覆盖替代执行者的包、checkpoint 和事件。
- token、租约版本、工作流版本分别失效，所有暂存效果丢弃；新进程从持久 token 恢复。
- 算法超时、检索超时耗尽重试后 FAILED，不创建医生复核或正式诊断。
- Worker 在模型调用中被终止三次，恢复后 RETRY_EXHAUSTED，输入验证不重复。
- MySQL SKIP LOCKED 跳过锁定任务，仍可推进另一任务。
- 解释模型网络、限流、服务端、总期限五种故障的任务 API 终态及日志脱敏。

## 2026-10-14 验证结果

最终证据位于 `.scratch/python-agent-migration/evidence/issue16/`：

- `final/results.json`、`final/flyway-*.log`：真实 MySQL 8.0.26，V1–V22 migrate/validate。
- `final/mysql-tests.log`：14 项真实 MySQL / 实际 Worker 进程测试通过（102.08 秒）。
- `verified-full-suite.log`：最终 Python Web 全量回归 699 通过、2 跳过（234.22 秒）；
  1 条既有 Pydantic 未解析前向引用警告。
- `mypy.log`：7 个相关源文件类型检查通过。
- `runtime-sources.json`：实际被测 worktree 关键源码的 SHA-256；包含保留的前票实现。
- `docs/workflow/issue16-review.md`：规范轴、Spec 轴复审结果。

本票验证的是**真实 MySQL + 实际执行者 + 受控外部依赖**。Java 身份、
算法权重、Chroma/embedding、解释提供商使用替身；真实 Java 会话、真实模型、
生产部署/回滚及临床验收没有在本票执行。未修改 Java 源码、pom.xml 或源 spec，
没有创建正式诊断记录。SQLite 回归不充当 MySQL 并发证据。

## 提交边界

本次起点 `da82b3629dbda31c64a0a6c25ec60433c29c68e6` 已有多票未提交内容。
提交仅含本票增量；共享 Worker 和既有测试采用增量暂存，其他前票改动保留。
解释实现 `algorithm/web/workflow/explanation.py` 及其原测试
`algorithm/web/tests/test_validated_explanation.py` 在起点尚未跟踪，不能把整份
前票文件当成本票提交。因此这两处本票修改**已经应用在当前 worktree**，其精确
增量保存在 `docs/workflow/issue16-prior-work.patch` 随本票提交。

合并前票后，在尚未应用本票修正的相同基线上使用
`git apply --unidiff-zero docs/workflow/issue16-prior-work.patch`；当前工作目录
已经应用，勿重复应用。本票提交依赖保留的前票实现，不宣称独立 checkout 可复现。

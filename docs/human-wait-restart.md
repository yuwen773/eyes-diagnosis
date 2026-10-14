# 工单 17：人工等待跨重启恢复

本票覆盖 AC-12 中的质量复核、最终临床复核、保存确认和补充输入等待。
使用真实 TCP HTTP、独立 API/Worker 进程和 MySQL 持久存储验证。
Java 身份、算法、检索和解释提供商为受控适配器，不能据此宣称真实模型或临床验收。

## 修复

1. 保存确认的创建、批准和拒绝在返回成功响应前提交事务。原实现依赖请求清理阶段
   提交，客户端收到成功后立即停止进程可能丢失确认或正式保存。测试在清理阶段
   注入短延迟，收到响应后立即停止 API，再验证原确认、批准回执和唯一正式记录。
2. Checkpoint saver 读取本段执行结果时优先使用从业务 token 继续执行而产生的
   暂存 checkpoint。原实现按 ID 与数据库全局最新 checkpoint 比较，可能选中
   废弃分支，覆盖医生决定。孤儿分支回归先复现 REJECTED，再验证原审批正常完成。

MySQL 中的工作流、审核、推理包、解释快照、保存确认和审计继续作为业务真相。
未增加 Worker 临床路由、修改图拓扑、修改 Java 源码、修改旧迁移或源 spec。

## 验收矩阵

| 等待/故障 | 重启后的公开行为 | 持久效果 |
| --- | --- | --- |
| 质量复核 OPEN / CLAIMED / 已提交 | 同一医生通过原 API 领取、提交和重放；旧版本 409 | 原推理包不变；qualityReview 一次；无正式记录 |
| 最终临床复核 OPEN / CLAIMED / 已提交 | 恢复原解释和原版本；提交后重启 Worker 发布 | 原解释内容不变；复核/发布审计不重复；无正式记录 |
| 保存确认 PENDING / 已批准 / 已拒绝 | 恢复原内容摘要；原批准回执重放；拒绝后不能批准 | 批准只产生一条正式记录与回执；拒绝无记录 |
| 保存确认过期 | 批准 409；可查询 EXPIRED | 无正式记录 |
| 补充输入 WAITING / ANSWERED | 恢复原会话和问题；旧答案重放不消耗新等待 | 回答消息一次；不改变临床工作流或重跑推理 |
| graphVersion / graphHash / actionVersion 不兼容 | 重建 Worker 后 FAILED / GRAPH_VERSION_INCOMPATIBLE | 保留原推理包和医生决定；有失败事件；再次运行不改变结果 |
| 业务 token 对应 checkpoint 缺失 | FAILED / CHECKPOINT_UNAVAILABLE | 不从其他 checkpoint 猜测恢复 |
| 补充输入图版本不兼容 | 返回业务冲突及明确刷新提示 | 保留 WAITING、原版本及问题，不产生回答 |
| 未被业务 token 引用的较新 checkpoint | 继续原批准的质量复核 | 废弃分支不能覆盖工作流、审计或解释 |

## 复现

在 PowerShell 7 中从 `algorithm` 运行，使用本地 MySQL 管理连接：

```powershell
$env:WORKER_TEST_MYSQL_ADMIN_URL='mysql+pymysql://<user>:<password>@127.0.0.1:3307/'
& .venv-baseline/Scripts/python.exe -m web.verify_worker_concurrency --suite human-wait-restart --output-dir ../.scratch/python-agent-migration/evidence/issue17/reproduction
```

运行器只连接本机，创建随机 `eye_human_wait_issue17_` 数据库并保留它。
先从 schema.sql 提取前 Flyway 的知识库及用户表 CREATE 语句，再使用指定
JDK 21 执行 Flyway V1–V22 migrate/validate。不会执行 schema.sql 中的
USE、ALTER 或 DROP；生产 Web 不自动建表。每个用例清理的仅是已检查前缀的测试库。

已有迁移完成的隔离库可直接运行：

```powershell
$env:HUMAN_WAIT_TEST_MYSQL_URL='mysql+pymysql://<user>:<password>@127.0.0.1:3307/eye_human_wait_issue17_<id>'
$env:HUMAN_WAIT_EVIDENCE_DIR='../.scratch/python-agent-migration/evidence/issue17/reproduction/cases'
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_human_wait_restart.py -q
```

完整 Python Web 回归需要为旧 Word 解析使用仓库指定的 JDK：

```powershell
$env:JAVA_HOME='C:\Users\yuwen\.jdks\corretto-21.0.7'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
```

API 使用生产路由和受控测试 lifespan，经过 TCP 提交请求，不使用 TestClient
代替网络响应。每次等待后停止自身 API 子进程树并检查端口已关闭，随后以新进程
重新启动。Worker 使用生产执行器和图，在独立进程内执行到持久等待后退出，恢复
使用新进程及禁止再次推理的适配器。未引入内存 saver 或生产故障注入路由。

`cases/*.json` 记录 API/Worker PID、工作流与 checkpoint 标识、版本、等待原因、
完整推理包、解释、复核、审计、保存确认、正式记录和外部调用次数。
`source-sha256.json` 记录被测 Python 源码指纹；`results.json` 和日志记录迁移及测试结果。

## 验证结果

2026-10-14 最终结果：

- 真实 MySQL 8.0.26 隔离库，Flyway V1–V22 migrate/validate 通过。
- `mysql-verified-final.log`：12 项 TCP HTTP / 独立进程恢复测试通过（261.83 秒）。
- `full-suite-java21.log`：Python Web 全量 711 通过、2 跳过（491.35 秒），
  1 条既有 Pydantic 前向引用警告。跳过项不计为验收通过。
- `mypy.log`：5 个相关文件检查通过，包含 `--check-untyped-defs`。
- `verified-final/cases/*.json`、`verified-final/source-sha256.json`：最终用例效果与源码指纹。
- `docs/workflow/issue17-results.json`：可提交的机器可读汇总。
- `docs/workflow/issue17-review.md`：规范轴和 Spec 轴均 0 项发现，新增断言复审仍为 0。

原始证据位于 `.scratch/python-agent-migration/evidence/issue17/`。首轮 MySQL
夹具缺用户表且未隔离故障用例遗留任务，修正夹具后重新验证。早期全量运行发现
默认 Java 无法执行旧 Word 解析；指定 JDK 21 后定向及完整回归均通过。
未使用早期失败或中止日志作为通过证据。

真实 Java 会话、真实权重、真实 Chroma/提供商、前端桌面操作、部署回滚和临床
验收不在本票执行；整个迁移仍需后续工单完成相应验收。

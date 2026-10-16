# 工单 05：现有 Python 等待任务升级与重启恢复

实施位置：`py-rewrite` / `worktree-py-rewrite`。升级前代码固定为提交 `cf31e88f28fb00ae3cfd8cc6a1534076363b7de3`，不是从修改后的代码生成“升级前”样本。

## 恢复行为

既有任务仍按原用户、图版本、输入与 checkpoint 恢复。重新登录只轮换 Python Cookie/Redis 登录态，不创建任务。医生质量复核、最终临床复核、用户保存确认和聊天补充各自保有原来的状态与授权含义。医生同意继续或确认 AI 评估均不建立正式诊断记录；只有用户明确批准当前拟保存内容才写入一次。

本次生产改动补齐保存确认的图版本边界：待确认保存遇到诊断图 version/hash/action 不兼容时返回 HTTP 409，保留原确认内容和状态。读取仍可查看原任务和确认；已经提交的回执可幂等读取，不重新执行写入。没有修改图结构、action 语义、冻结 AI 来源或既有 checkpoint 格式，也没有重建任务来代替恢复。

质量/最终复核继续使用原有版本检查；聊天补充独立检查 `chat-supplement-v1` 及绑定 checkpoint。诊断图冻结基线是 `upload-final-clinical-review-v6`，hash 为 `91e85f7473552e4531c4727b95d5764e0b802be3ee441f69731eee5dfd4aace6`，action 为同版本。`web.migrations baseline-check` 比较实际导出结构与冻结资产，不以源码路径或肉眼观察替代兼容性检查。

## 验证方式

证据目录：[工单 05](../.scratch/python-project-migration/evidence/issue05/)。最终计数、状态与局限见 [verification-summary.json](../.scratch/python-project-migration/evidence/issue05/verification-summary.json)，双轴复核见 [review.md](../.scratch/python-project-migration/evidence/issue05/review.md)。

- 为每类等待新建受保护的本机 MySQL schema，从冻结 V22 SQL/历史初始化，再由固定旧代码的独立 API/Worker 生成真实持久等待。保存的 JSON 样本包含原输入、checkpoint/pending writes 的原始 base64 字节及 SHA256、图基线、推理来源、复核/保存/补充内容、作业和审计；所有临床内容均为合成数据。验收库留存，没有清理业务库。
- 原 API/Worker 结束后执行独立 Python `upgrade`；升级前后的全表数量与内容摘要相同。新代码使用原数据库，用户通过真实登录接口和独立 Redis 子进程重新登录，再继续原等待。生成等待及升级后继续处理主路径的 API/Worker 子进程使用无效 `JAVA_HOME`、空 `PATH`，不调用 JVM；租约故障用例的额外 executor 继承测试父进程环境，单独提供 MySQL fencing 证据，不计为无 JVM 隔离验收。
- 质量与最终复核在领取、提交及继续处理之间跨 API/Worker 进程；保存等待在重启后并发批准、再次重启后重放，验证仅一条正式记录；过期确认不写入。聊天补充在原聊天继续一次，历史保留，不改变诊断状态或授权。
- 状态、聊天历史和重连 SSE 指向同一任务；四种原 Vue 页面在升级后刷新仍显示对应等待，刷新期间没有创建任务的 POST。浏览器为 Playwright 无头 Chromium，不代表物理桌面验收。
- 不兼容 version/hash/action 和独立补充图返回明确冲突；真实 MySQL 全表摘要证明失败路径没有丢弃 checkpoint、pending writes 或改变等待。保存确认的三个版本字段另外通过 HTTP 先红后绿回归。
- 独立 Worker 在复核后续检索处被阻塞时，真实 MySQL `NOWAIT` 能取得作业/工作流锁，证明外部调用不占用业务事务。注入租约过期后新 Worker 轮换令牌和递增 fencing 版本；旧 Worker 返回或被终止后，原推理与已提交结果保留，无重复正式记录。

## 重现

在 `algorithm` 目录设置本地验收连接和已安装的 Redis 可执行文件路径；连接值只通过进程环境传递，不写入证据或提交：

```powershell
$env:HANDOFF_TEST_MYSQL_ADMIN_URL = '<local mysql+pymysql admin URL without schema>'
$env:WAIT_RECOVERY_REDIS_SERVER = '<absolute redis-server executable>'
$env:WAIT_RECOVERY_BROWSER = '1'
$env:HUMAN_WAIT_EVIDENCE_DIR = '../.scratch/python-project-migration/evidence/issue05-new-run'
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_python_wait_recovery.py -q
```

PowerShell 命令通过 `pwsh.exe -NoLogo -NoProfile -Command` 执行。需已安装 Web 测试依赖、Chromium 和前端 `node_modules`。用例仅创建新的本机隔离 schema、Redis/API/Worker/Vite 自有进程；不会停止已有服务。测试不复用 Java Cookie，也不把内存会话替身计为真实身份验收。未提供显式验收环境时，真实基础设施用例跳过。

## 验收边界

真实 MySQL/Redis、TCP API/Worker 和原 Vue 的恢复证据单独报告；算法、检索与解释供应商是受控外部适配。没有调用真实模型/供应商、做临床验收、执行生产库升级或切流。现有 Windows Web 全量仍包含保留到后续工单的 Java 契约/历史检查，因此按仓库要求配置 JDK；它不代表项目整体已达到无 JVM 最终交付。Linux 全量/部署及工单 03 的已知 Linux 全量失败仍属后续门禁。本次没有 push，也没有启动工单 06–08。

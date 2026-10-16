# 首次 Python 切换与故障恢复演练（工单 07）

本文仅用于隔离环境。真实业务库升级、生产路由重载和生产发布均未授权。
原 Java、原 SQL 和旧工单证据保留；本票使用不可变提交引用，不创建工单 08 的历史标签。

## 前置条件与固定发布

- 工作区为 `.claude/worktrees/py-rewrite`，当前分支 `worktree-py-rewrite`。
  工单 06 已交付，其支持范围内工程及真实基础设施门禁通过，待人工复核。
- 首次回退槽固定为提交 `5733cf33823257e8be2aa1ad2c3fd13e7b5754f0` 中保留的
  Java 工程；Java 最近修改引用为 `00892d419130fbe999e69df30a3476b82b5637ec`。
  从该提交导出 `src` 和 `pom.xml`，在私有隔离目录离线构建 JAR，记录源码归档与
  JAR 的 SHA256。不使用主工作区的未知来源 JAR，也不把源码归档/配置秘密提交到 Git。
- 纯 Python API/Worker 使用同一固定提交中的独立 Python 源码归档执行；四类升级前
  等待样本由工单 05 固定的 `cf31e88` 生成。网关为本票新入口 `python -m web.maintenance`。
- 本票旧槽仅在恢复 Python 写入前临时使用 JDK 21。纯 Python 槽、数据库承接、备份、
  维护网关及故障后修复均不运行 Java、Maven 或 Flyway。旧槽的离线构建不是当前
  Python 安装或 CI 的步骤；工单 08 后常规发布和回退不得要求重建旧槽。
- 本机 MySQL 管理连接必须无数据库名；演练只新建随机 `eye_human_wait_issue17_*`
  与 `eye_pyhandoff_*` 库。所有服务绑定随机回环端口；已有进程、服务、数据库、
  Redis 命名空间、Chroma 集合和对象目录均不复用。数据及私有日志保留，不自动删库。

旧产物准备示例（在 PowerShell 7，使用新的私有目录，不覆盖已有归档）：

```powershell
$legacyRelease = '5733cf33823257e8be2aa1ad2c3fd13e7b5754f0'
$legacyRoot = Join-Path (Get-Location) '.scratch/baseline-runtime/ticket07-legacy-5733cf3'
New-Item -ItemType Directory -Force $legacyRoot | Out-Null
git archive --format=zip --output="$legacyRoot/source.zip" $legacyRelease src pom.xml
Expand-Archive -LiteralPath "$legacyRoot/source.zip" -DestinationPath "$legacyRoot/source"
$env:JAVA_HOME = 'C:/Users/yuwen/.jdks/corretto-21.0.7'
$env:PATH = "$env:JAVA_HOME/bin;$env:PATH"
mvn.cmd -o -f "$legacyRoot/source/pom.xml" package -DskipTests
```

## 重现入口

使用项目 `.venv/Scripts/python.exe`。预先设置以下环境变量，不把连接秘密打印或写入
公开证据。可执行路径必须指向已安装工具，入口不联网下载依赖。

| 环境变量 | 内容 |
|---|---|
| `HANDOFF_TEST_MYSQL_ADMIN_URL` | 本机 MySQL 8 管理 URL，无数据库名 |
| `WAIT_RECOVERY_REDIS_SERVER` | 独立 Redis 可执行文件 |
| `CUTOVER_NGINX` | 已安装 Nginx 可执行文件 |
| `CUTOVER_JAVA` | 已安装 JDK 21 的 java 可执行文件，仅供旧槽 |
| `CUTOVER_LEGACY_JAR` | 上述离线构建的 JAR |
| `CUTOVER_LEGACY_SOURCE_ZIP` | 对应固定提交的源码归档，入口与 Git 重新核验 |
| `CUTOVER_MYSQL_BIN` | 包含 mysqldump/mysql 的安装目录 |
| `CUTOVER_EVIDENCE_DIR` | 本次新的公开合成证据目录 |
| `HUMAN_WAIT_EVIDENCE_DIR` | 同一证据目录，用于四类等待的合成快照 |

```powershell
& .venv/Scripts/python.exe -m pytest algorithm/web/tests/test_maintenance.py -q
& .venv/Scripts/python.exe -m pytest algorithm/web/tests/test_cutover_rehearsal.py -q --tb=short
```

缺少显式环境变量时演练跳过，不记为通过。完整 Web 回归不自动启动旧 Java，真实
演练独立报告。Docker 当前未启动，本票不修复 Docker/WSL，也不把 Windows 演练
扩大为 Linux/Compose 切换验收；工单 06 的 Linux 工程证据独立保留。

## 维护窗口步骤与退出判据

1. 核对发布引用、产物摘要、数据库/对象/向量目标和只绑定回环的服务拓扑。
   隔离目标或来源不明立即停止。四类等待分别留存输入、checkpoint、pending writes、
   图/动作版本、AI 来源、医生复核和保存确认；旧 Java 任务保留原状态与归属。
2. 网关切到 `readonly`，实际检查业务写入、上传、聊天、新任务、复核与保存批准均
   返回 503/Retry-After。允许 GET/HEAD/OPTIONS、精确白名单内的查询 POST，以及
   登录/登出。白名单不匹配路径前缀；不存在的未来写端点也默认拒绝。
   登录只更新身份状态；演练账号已使用 BCrypt，不在备份边界升级密码格式。
3. 停止所有 Worker 的新增领取。独立一次性 Worker 完成当前在途段并退出，确认
   没有 RUNNING 租约，READY 任务保持不变。真实部署若不能确认全部执行器已停或
   租约仍有效，应继续等待或退出维护，不能通过改状态/清 checkpoint 来强行排空。
   已终止执行器的租约须自然失效；后续由原 fencing 规则接管，不复用旧令牌。
4. 在无业务写入/领取期间创建一致性备份：MySQL `--single-transaction` 全库转储
   （含历史与 checkpoint 字节）、Redis RDB、停机后的 Chroma 持久目录、对象字节及
   引用清单、SQL/图版本及发布摘要。将 MySQL 转储恢复到**另一个新建隔离库**，
   比较全表原行摘要。备份文件保留在忽略的私有运行目录，公开证据只保存摘要。
5. 显式执行 Python `inspect/upgrade`，不修复未知历史。启动固定 Python API，
   网关切到 `python/readonly`。验证原密码重新登录、旧 Cookie 无权、原新闻和旧任务
   视图、四类等待的 HTTP/SSE 状态与持久内容。此时不运行会消费 READY 的 Worker。
6. **写入前失败分支**：终止本次 Python API 注入 502；停止新进程后将同一网关退回
   固定旧槽并重新登录。核验原数据与四类等待的全表摘要，禁止任务重标或丢失。
   演练没有覆盖旧备份，退旧槽也不将 Python 图交给 Java。
7. 旧槽退出后重新切到 `python/readonly` 并复核。确认允许恢复写入后生成
   `python/active`，持久登记 `pythonWritesOpened=true`，实际切换配置后再领取任务。
   演练明确保存一条诊断记录，重放批准只返回原结果；再创建新的工作流作为新增数据哨兵。
8. **写入后失败分支**：终止本次 API 注入故障，立即回到 `python/readonly` 并停领取。
   保存故障后全表摘要与审计；生成旧槽回退配置必须被拒绝且现有配置/账本不变。
   **不能切回 Java，不能将旧转储恢复到源库。**
9. 首个纯 Python 发布没有更早的兼容 Python 包：本次通过重启固定 Python 产物向前
   修复，在只读网关后核验新增工作流、诊断保存回执、批准与审计仍在，再开放写入。
   四类等待分别续办，医生复核仍不自动建档，保存重放仍只有一条正式记录。
   后续发布若已有兼容 Python 回退包，应单独验证包/schema/图版本兼容后才允许应用回退。
10. 重新启动原 Chroma 检查向量/metadata/文档一致，对象摘要一致。结束只终止本次
    Popen 管理的服务，不按进程名全局终止、不清理隔离库或备份。记录各段实际时长。

维护窗口的退出判据是：停写实际生效、领取停止且租约可解释、备份可恢复、原数据及
四类等待无损、旧任务可查看、身份可用、写入后保全与向前修复通过。任何一项失败
均不应恢复业务写入。生产所需人力、在途规模和备份量不同，演练时长不作为生产停机 SLA。

## 网关操作约束

`web.maintenance` 只生成本机 Nginx 配置与同目录 `maintenance.json`，不执行重载、
数据库操作或进程停止。显式提供三个互不相同的端口、完整发布 SHA、产物 SHA256 和
操作原因；先 `nginx -t`，再由操作者应用到本次独立网关。真实运行须将后端监听限制在
私有网络或回环，避免绕过网关写入；同时停用所有外部写入者/后台调度器。

整个首次切换必须使用**同一输出目录和账本**。生成 active 配置即保守记录不可退旧版
边界，故障后不得通过新目录、删账本或手改 `pythonWritesOpened` 绕过；账本不替代
业务数据审计。并行生成通过独占锁拒绝；残留锁须人工核对已装配置及账本后处理。
本票不提供恢复旧备份覆盖源库的命令。

最终数值、产物摘要与验收范围见
`.scratch/python-project-migration/evidence/issue07/verification-summary.json`。
真实 embedding/LLM/分类/COS、临床、生产升级/切流、托管 CI 与工单 08 独立记录。

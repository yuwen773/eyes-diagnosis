# Python 数据库承接（工单 01）

这是独立部署步骤。API/Worker 启动不执行 DDL；旧 Java、SQL、Flyway 历史及历史规范保留原状。本工单没有完成身份替换、生产切流或全项目去 Java。

## 入口与依赖

沿用 `algorithm/requirements-web.lock` 的 Python 3.11、PyMySQL 1.2.3、SQLAlchemy 2.1.4；不增加迁移框架或调用 JVM。Python 历史由本目录固定资产和 `web.migrations` 管理，使用独立的 `t_python_schema_history`。不伪造或更新 Flyway 历史。

在仓库的 `algorithm/` 目录运行（Windows 使用 `pwsh.exe -NoLogo -NoProfile`）：

```powershell
# 无数据库的基线检查；也核对当前诊断图/补充图的版本和导出结构。
& '.\.venv-baseline\Scripts\python.exe' -m web.migrations baseline-check

# 从本地秘密存储设置 MIGRATION_MYSQL_URL，勿把账号密码写入命令记录/工单。
# 格式为 mysql+pymysql://<user>:<url-encoded-password>@<host>:<port>/<existing-schema>
& '.\.venv-baseline\Scripts\python.exe' -m web.migrations inspect
& '.\.venv-baseline\Scripts\python.exe' -m web.migrations upgrade
```

Linux 使用同一模块入口：`python -m web.migrations ...`。本工单的实际验收环境是 Windows、Python 3.11.17、MySQL 8.0.26；Linux 实测在后续工程工单完成，不能据此宣称 Linux 已验收。

`inspect` 只读。`upgrade` 在取得数据库级命名锁后重新核验，默认不等待并发升级；占用时返回 `UPGRADE_BUSY`。成功/无需变化退出 0，漂移/阻塞/失败退出 2，stdout 为 JSON。连接参数只从环境读取，驱动异常和业务行内容不进入报告。凭据需要 URL 编码；不接受 SQLite 代替 MySQL 验收。

## 已验证的起点

| 起点 | 前置核验 | 操作 |
|---|---|---|
| 完全空 schema | 无任何业务表或历史 | callback → 明确的业务 bootstrap → V1–V22 → Python P1 |
| 代表性 V9 | V1–V9 连续且成功、script/checksum/rank 正确、完整 `schema-v9.json` 匹配 | 仅执行 V10–V22，原历史逐字值保留，登记 P1 |
| V22 快照 | V1–V22 连续且成功、script/checksum/rank 正确、完整 `schema-v22.json` 匹配 | 不重放旧 SQL，核验后登记 P1 |
| Python P1 及后续 | 所有已应用版本的固定 checksum、完成状态、旧历史摘要和相应结构快照匹配 | 仅执行尚未应用的 Python 增量；无增量则 `UNCHANGED` |

支持的是这些**完整结构配置**，不是“任何版本号为 V9/V22 的数据库”。schema 默认须为 `utf8mb4 / utf8mb4_unicode_ci`。表、列类型、默认值、索引、唯一/检查约束、引擎及 collation 均须匹配；额外表、视图/触发器/例程/事件、手工对齐、callback-only 不完整库、未知中间版本、失败历史、V8 checksum 分歧或其他 checksum 变化全部停止并报告差异，不自动 repair。大小写敏感的 MySQL 须保留声明的表名（旧 `t_chatSession` 例外，其余为小写），不允许通过归并表名隐藏漂移。MySQL 5.7 不在本次支持范围；CLI 在 DDL 前拒绝。支持范围之外须另做只读核验和升级方案。

旧历史允许在首行保留 Flyway 的 version=0、checksum=NULL baseline，随后须为连续成功 SQL 历史。不向原历史写入 V10–V22 的假 Flyway 记录：Python P1 自己记录 sourceVersion、升级计划身份和原历史/数据摘要。交接后停用旧 Flyway 升级入口，不能让两套部署升级器同时工作。

## 资产与初始化效果

- `legacy/` 保存旧 V1–V22、callback 和 `schema.sql` 的捕获原字节。`manifest.json` 记录 SHA-256、字节数、原路径、Git 原始 blob SHA-256 和 Flyway CRC32。`.gitattributes` 禁止复制资产的换行转换。源文件可以匹配捕获的 Windows 字节或原 Git blob 字节，两种身份明确分开；任意其他变化报错。
- `schema.sql` 仅作历史证据，**不整体执行**其 `CREATE DATABASE diagnosis`、`USE`、`DROP` 或重复 ALTER。
- `business-bootstrap.sql` 明确提取用户、新闻及附件/段落、传统聊天历史、Agent 会话、知识库的 CREATE 定义。旧聊天会话保留最终已去除 message 列的结构；不依赖 Windows 对表名大小写的宽容。诊断/MCP 表由原 callback 提供，消息/缓存/上传/工作流表由原版本 SQL 提供。历史 schema 中无实体映射的 `image_hash` 手工列不加到该受控配置；拥有它的旧库会被列为结构差异，不能静默承接。
- V9/V22 快照在新建隔离库中通过 MySQL 自身多语句解析建立，独立于 CLI 的 SQL 分句器。源 SQL 与原规范没有编辑。
- `contracts.json` 冻结旧 `code/msg/data`、Long 字符串、分页、日期、40100 与独立工作流 HTTP 202/401/403/409、SSE state/done。旧日期 UTC 序列化行为保留，旧缺陷另列。
- `recovery-samples.json` 冻结导出诊断图、graph/hash/action version，以及独立聊天补充图；列明三类诊断数据和四类人工等待的稳定 ID、归属、来源、审核/批准/审计不变量。样本均为合成数据，无真实个人数据、凭据、账号哈希或供应商回答。
- `dependency-inventory.json` 记录核查基点的 75 个活跃依赖文件与行号。包含 Java 会话回调、Maven/Flyway 升级脚本、Tika、读取 Java/schema/config 的测试、CI setup-java 以及当前 README/运行说明。它是后续替代清单，不授权工单 01 删除这些资产。

## 中断、失败及数据保全

先备份并暂停业务写入、停止 Worker 领取和旧升级器，再执行 `inspect`/`upgrade`；本工单仅在新建隔离验收库验证，从未升级业务库。命名锁协调 Python 升级器，不代替维护窗口，也不阻止业务写入。

MySQL DDL 隐式提交，因此不能把整次升级称为可事务回滚。执行 DDL 前，P1/各增量先提交 `RUNNING`；每条语句后记录进度。异常登记 `FAILED`；进程死亡保留 `RUNNING`。CREATE 历史表和首次登记之间若中断，空 Python 历史同样阻塞。DDL 完成且结构/数据检查通过后，才原子提交 `APPLIED`，避免提前登记成功。

遇到 `RUNNING`、`FAILED` 或空历史：止写，保留库、日志与备份，由运维逐条核查实际 DDL 和记录进度，另行制定恢复步骤。CLI 没有 `repair`、清历史、强制重放或自动回滚入口。断开的客户端可能短暂留下仍在执行的数据库语句，此时先显示 `UPGRADE_BUSY`，连接退出后显示中断阻塞。

旧数据按每张原表的原列投影、稳定主键顺序核对行数和整行摘要；含输入字节、checkpoint/pending writes、用户归属、AI 来源、医生审核、保存授权和审计。报告只保存表级摘要，不输出行内容或账号密码哈希。新增列不会导致旧投影发生假差异；旧列任何变化会阻止登记成功。原 Flyway 全行摘要在重复升级时继续核验。

## 后续 Python 增量

P1 只建立一次，`baselineFiles` 和 `baselineChecksum` 冻结。新增版本从 P2 连续编号：新增 `.sql`、该版本的完整业务结构快照，并将二者摘要加入 `files`，在 `increments` 添加 `{version, asset, schema, sha256}`。每个增量登记的 checksum 同时绑定版本描述、SQL SHA-256 和目标结构 SHA-256，不能通过改写快照把手工漂移合法化。不得改变既有 P1 资产或 checksum，也不复用版本号；未知/缺号计划在执行前阻塞。

每个增量沿用独立的 RUNNING/APPLIED/FAILED、并发锁与原数据投影检查。增量已应用后更改 SQL 或结构快照会被拒绝。测试用临时 P2 执行真实 ADD COLUMN，验证增量及重复执行；该探针列不进入实际发布资产。

## 验证

从秘密存储设置 `HANDOFF_TEST_MYSQL_ADMIN_URL`（只允许 localhost/127.0.0.1），然后在 `algorithm/` 执行：

```powershell
& '.\.venv-baseline\Scripts\python.exe' -m pytest web/tests/test_database_handoff.py web/tests/test_handoff_contracts.py web/tests/test_handoff_recovery.py -q --tb=short
```

验收新建并保留 `eye_pyhandoff_*` / `eye_human_wait_issue17_*` 库，不删除既有库。CLI 与 API/Worker 子进程用不存在的 JAVA_HOME 和空 PATH；公开新闻读取运行原始 API，等待恢复运行生产路由/Worker及受控身份/模型/检索适配器。后者不证明真实登录、供应商模型或临床验收。

证据见仓库 `docs/python-database-handoff-evidence.md`。全项目无 JVM、真实 Redis 身份、Linux、真实模型/供应商及临床结果属于独立门槛。

实现依据：[Flyway ChecksumCalculator](https://github.com/flyway/flyway/blob/main/flyway-core/src/main/java/org/flywaydb/core/internal/resolver/ChecksumCalculator.java)、[MySQL 隐式提交](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html)、[MySQL 命名锁](https://dev.mysql.com/doc/refman/8.0/en/locking-functions.html)（2026-10-15 核对）。

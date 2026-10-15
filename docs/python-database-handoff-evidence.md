# 工单 01：Python 数据库迁移与数据保全验收

日期：2026-10-15（Asia/Shanghai）。工作位置：`.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。核查基点：`a57e6fb50a12e16e59b2e245435070a952258fb9`。

**结果：工单 01 支持范围通过，ready-for-human。** 专项 **28 passed / 0 skipped**；完整 Web 回归 **726 passed / 24 skipped**；迁移模块类型检查通过。机器结果及 JUnit 见 [.scratch 证据](../.scratch/python-project-migration/evidence/issue01/results.json)。使用与恢复说明见 [迁移入口](../deploy/python-migrations/README.md)。

## 环境及分层

| 层级 | 结果与实际范围 |
|---|---|
| 数据库迁移无 JVM | PASS；CLI 子进程 PATH 为空、JAVA_HOME 不可用，无 Java/Maven/Flyway 子进程 |
| 真实数据库 | PASS；Windows、Python 3.11.17、MySQL 8.0.26，lower_case_table_names=1；只在新建隔离库运行 |
| 原始 API 公开读取 | PASS；真实 TCP `/health`、新闻详情和分页；旧库的合成新闻在升级前写入，升级后按原 Long ID 读取 |
| 四类等待恢复 | PASS；真实 MySQL、生产 API/Worker 子进程；身份、分类、证据/解释为合成外部适配器 |
| 大小写敏感保护 | CONTROLLED_PASS；审查员在数据库边界模拟 mode=0，验证拒绝同名大小写冲突和错误旧表拼写；不是 Linux 实测 |
| 完整 Web 回归 | PASS；既有回归仍设置 JDK21，保留旧源码/Tika 依赖；不把这一层称为全项目无 JVM |
| Linux、真实 Python/Redis 登录 | NOT_RUN；分别属于后续工程与身份工单 |
| 真实模型/供应商、临床 | NOT_VERIFIED；本工单不提供这些结论 |
| 业务库升级、生产切流、Java 移除 | NOT_RUN |

支持起点为默认 `utf8mb4_unicode_ci` 的空 schema、完整冻结 V9 配置及完整冻结 V22 配置。V9/V22 数字本身不足以取得承接资格。MySQL 5.7、其他起点/手工 schema、V8/未知 checksum、失败历史、未知结构对象均停止；没有修改、repair 或删除原历史的路径。

## 逐项验收

下表编号按原工单 Acceptance criteria 顺序，工单原要求未改写。

| 判据 | 实现与验证 |
|---|---|
| 1 独立契约 | `contracts.json` 与 `test_handoff_contracts.py`：旧封装、超 JS 安全整数 Long、分页、既有日期、过期 40100；新工作流 202/401/403/409、幂等与 SSE state/done。没有读取 Java 源码来生成测试期望 |
| 2 原字节与依赖清单 | 22 份旧迁移 + callback + schema 捕获字节、原 Git blob 摘要及 Flyway CRC32；75 个活跃依赖文件/行号。原来源文件原字节复核不变；30 个冻结资产的 Git 暂存字节均匹配 SHA-256 |
| 3 三类数据/四类等待 | `recovery-samples.json` 固定独立定义、导出主图及补充图版本；真实恢复用例含传统诊断、旧 Java 上传任务及未反序列化 checkpoint、Python 人工等待 |
| 4 基线扩展阶段 | `baseline-check` 不连接数据库；SQL 字节漂移可报告；当前图及 action/supplement 版本对冻结样本核验。API/Worker 没有导入迁移模块；旧生产路径/规范保留 |
| 5 无 JVM 初始化 | callback → 显式 business bootstrap → 原 V1–V22；不执行历史 schema 的 USE/DROP/重复 ALTER。不通过 ORM create_all 初始化 MySQL |
| 6 独立历史与增量 | `t_python_schema_history` 与 GET_LOCK；P1 首次登记、无变化重复、隔离临时 P2 ADD COLUMN 及重复运行通过。P2 历史同时绑定 SQL 和目标结构身份 |
| 7 空库 HTTP 与结构 | 原始 API 进程健康、公开详情/分页读取通过；V9/V22 结构快照包含 15/35 张业务表，比较完整 SHOW CREATE，包括 camelCase、类型、默认值、索引和约束 |
| 8 非事务失败 | 隔离增量先 CREATE 再故意失败：保留实际 DDL、历史 FAILED、进度 1；再次运行拒绝重放。中断测试在 RUNNING 登记后终止自建 CLI 子进程，不能登记 APPLIED |
| 9 明确旧库起点 | 两个旧库配置均通过 MySQL 自身脚本解析独立建立，CLI 分句器不生成期望结构；V9 仅执行 V10–V22，V22 无旧 SQL 重放 |
| 10 历史核验 | 连续版本/rank、type/script/checksum、成功状态及结构在写入前核验；V8、V9 checksum、失败/未知历史、列漂移拒绝且无新历史表；承接后原历史 installed_by 被改写仍拒绝 |
| 11 数据与批准不变量 | 原表的原列投影、行数及整行摘要升级前后相同，包括稳定 ID、归属/角色、原密码字段、AI/人工字段、原始输入、checkpoint、pending writes、审计。四类等待在承接后由新 API/Worker 进程读取并继续；医生复核不能形成保存 receipt，用户明确保存才形成一次 receipt |
| 12 原子边界/安全输出 | 空 Python 历史识别为首次登记中断；并发升级不写入；RUNNING/FAILED 不自动恢复。CLI JSON 不输出连接秘密、驱动原异常或行内容；审计只存表级摘要。未知视图不能被当成空库 |

`test_handoff_recovery.py` 的四种真实 MySQL 用例分别在承接前持久化质量复核、最终复核、保存确认、聊天补充等待；停止原 API/Worker 后承接，再启动新进程读取相同等待内容并继续。补充回复不授权临床写入，旧 Java 原任务/原 checkpoint 保留原状，不把它们宣称为可续跑。

旧日期序列化缺陷按已冻结行为保留；历史 schema 中手工 `image_hash` 等额外列也不会被静默接受。本工单没有扩展新闻可见性、登录、旧任务重建或临床规则。

## 执行结果

```text
python -m pytest web/tests/test_database_handoff.py web/tests/test_handoff_contracts.py web/tests/test_handoff_recovery.py -q --tb=short
28 passed in 305.54s

python -m pytest web/tests -q --tb=short
726 passed, 24 skipped, 1 warning in 615.01s

python -m mypy web/migrations --follow-imports=silent --disable-error-code=import-untyped
Success: no issues found in 4 source files

python -m web.migrations baseline-check
{"differences": [], "legacyMigrations": 22, "status": "BASELINE_OK"}
```

完整回归未提供真实 MySQL 环境变量，因此跳过新增 22 个 opt-in 基础设施用例；它们已在专项的 28 项中全部执行通过。另两个既有 MySQL opt-in 跳过仍保留，没有宣称已补测。唯一 warning 为既有 MCP/Pydantic lifespan forward-reference 警告，本工单没有修改其实现。

专项 JUnit：[handoff-final.xml](../.scratch/python-project-migration/evidence/issue01/handoff-final.xml)。完整 Web JUnit：[full-web-results.xml](../.scratch/python-project-migration/evidence/issue01/full-web-results.xml)。执行日志与临时验收库保留在本地，未混入源码提交；摘要记录两个报告的 SHA-256。

## Standards

初次审查：没有文档规范违反或需要处理的代码气味；发现两项正确性问题：增量身份未绑定目标结构、大小写敏感数据库的表名归并。两项均已修复并经原审查员复核关闭。后者做了只读数据库边界模拟；Linux 实测状态保持 NOT_RUN。

**Standards：2 项已解决，0 项未解决；当前无最高级别未解决问题。**

## Spec

初次审查：发现增量目标结构身份可被改写这一项工单偏差。真实 MySQL 回归先复现“手工 ALTER + 改写快照及清单后仍返回 READY”，修复后同一行为返回 `PYTHON_CHECKSUM` 阻塞。原审查员确认闭环，其余要求无新增具体缺口。

**Spec：1 项已解决，0 项未解决；当前无最高级别未解决问题。**

上述两个审查轴分别报告，不用其中一轴的结果代替另一轴。

# Java 退出与最终验收（工单 08）

范围：`py-rewrite` / `worktree-py-rewrite`，2026-10-17（Asia/Shanghai）。

**状态：PARTIAL，工单 08 尚未整体验收完成。** 历史保全及受控 Java 退出已实施；
Linux 全量/真实基础设施最终门禁未闭环。用户明确要求保持 Docker 停止，后续须另行恢复验收。
工程、真实基础设施、真实供应商/模型及临床分别报告；没有执行生产业务库升级、
生产切流或 push。

## 先保全，再移除

前置工单 07 的 80 项已提交源码/证据摘要、全量 Web/真实 Nginx/切换演练的最终
JUnit 结果已核验。历史失败和受控供应商边界保持原状。

本地附注标签 `archive/java-before-python-retirement-2026-10-17` 固定到
`3eff16390721b4d8b5a36b6623d2bb0981b8a441`，含完整 Java、旧构建、SQL 和工单 07
证据。标签尚未推送。原 24 份 SQL 的捕获 SHA256/字节数和 Git blob 来源逐项一致；
`deploy/python-migrations` 与 `deploy/workflow-migrations/sql` 未改字节。

按[精确删除清单](../.scratch/python-project-migration/evidence/issue08/deletion-plan.json)
移除 203 个已跟踪文件：`src/` 原 Java 工程及配套资源、根构建文件、旧迁移构建文件
和旧真实服务 Java 探针。只删除清单中的文件，不递归清理整个目录。
原 README/AGENTS 和工单 07 Java 旧槽演练原文留存在 `docs/history/java/`；
演练测试保存为 `.py.txt`，不进入当前测试收集或执行。旧演练证据未删除或改为新结果。

当前 README/AGENTS 使用 Python 指引。CLAUDE.md 的既有内容（包括他人未提交修改）
完整留存于明确标注的历史区，新增当前入口覆盖旧操作指引。
忽略的 `target/`、`algorithm/.tools/`、已有运行文件、旧票数据库/日志、模型与数据集
均保留；这不是卸载整台开发机的 JDK，也不把历史缓存计入发布包。

## 当前验证入口

`python scripts/verify_retirement.py` 检查活跃构建、命令、包依赖与已移除源路径读取，
由 `scripts/verify.py web|frontend|infrastructure` 自动调用。静态扫描是有限规则门禁，
不能独自证明任意动态代码没有依赖；删除后的全量测试和干净镜像验证提供运行证据。
扫描的反例覆盖 Java 源码、旧构建、CI 工具安装、启动命令、Tika 依赖与源文件读取。

Windows 使用 PowerShell 7 和不可用的 `JAVA_HOME`，从 PATH 排除 Java/旧构建工具。
删除后最终串行 Web 全量 814 通过、43 跳过、1 条既有警告；134 包依赖、7 文件类型检查和冻结迁移基线通过。
Windows 最终真实基础设施主链通过：11 项 HTTP/身份/文档/工作流检查，14 项真实 MySQL 并发、12 项等待重启及 21 项数据库承接全部通过。供应商/模型/临床边界仍未验收。

真实基础设施测试仅创建随机本机隔离库和独立 Redis/Chroma/API/Worker；保留数据。
四类等待使用固定旧 Python 版本产生的样本升级，验证真实身份、checkpoint、审批、
保存重放及过期/版本冲突边界。旧任务只读视图和六路关联重建重试通过公开 HTTP 验证。

Linux 仍使用 `deploy/python/Dockerfile`、`Verify.Dockerfile`、前端镜像与 Compose；
已完成镜像构建、CPU 工程检查、306 项算法回归和 Compose/Vue 验收；
Linux 首轮 Web 在失败后受控终止，真实基础设施门禁也有失败，不能记为通过。
30 秒只读观测捕获约 2.8 秒回拨；生产时钟保护、业务租约和恢复断言没有修改。
Docker 随后正常停止，用户确认是主动关闭并要求暂不再启动；没有重启共享 WSL、
调整系统时钟或操作其中其他数据库服务。本地等价 CI 不代表托管 CI。结果与未执行项见
[机器汇总](../.scratch/python-project-migration/evidence/issue08/verification-summary.json)和
[证据索引](../.scratch/python-project-migration/evidence/issue08/README.md)。

## 恢复边界

当前生产图、人工等待、医生复核、用户保存授权与 AI 来源不因 Java 删除而变化。
历史标签用于查阅和复原原工程；恢复 Python 写入后不得运行历史旧槽覆盖新增数据。
故障先止写，首次 Python 发布向前修复；后续仅在兼容图/schema/授权版本的 Python
产物之间回退，具体维护网关与限制见[历史演练及恢复步骤](python-cutover-rehearsal.md)。

真实 embedding 的历史 HTTP 401、分类权重/供应商/LLM/COS 与临床未验收边界不变。
工程验收不构成模型效果、临床许可或生产发布批准。

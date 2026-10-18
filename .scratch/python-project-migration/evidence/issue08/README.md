# 工单 08 证据

日期：2026-10-17（Asia/Shanghai），基点 `3eff163`，分支 `worktree-py-rewrite`。

- `preflight.py` / `preflight.json`：删除前只读核对 07 摘要、JUnit 与 SQL 原字节。
- `deletion-plan.json`：本地历史标签、精确删除文件、SQL 摘要与留存范围。
- `red-scan.log` / `green-scan.log`：命令行扫描的测试驱动循环。
- `post-delete-scan.json`：第一轮扫描的误报，原样保留；最终结果另存。
- `windows-full.log` / `windows-full/web.xml`：删除后 Windows 共同入口全量。
- `windows-infrastructure/`：隔离真实基础设施及旧库承接。
- `waits.log` / `waits.xml` / `waits/`：固定旧 Python 的四类等待升级恢复及旧任务重建。
- `frontend.log`：Python OpenAPI、Vue 类型检查、构建及 Vitest。
- `mypy.log`：本票扫描/共同入口类型检查。

`preexisting.patch`、运行配置、连接凭据与原始数据库/对象/向量备份不纳入公开提交。
原工单失败证据不覆盖、不删除。双轴复审见 `review.md`，剩余问题各 0。当前机器汇总为 `PASS_WITH_LIMITATIONS`、4/4 工程范围；原 PARTIAL 快照、原环境失败和附时间同步条件的最终通过结果分别保留于 [本次收尾](closeout-20261017/README.md)。

## 分层结果与历史失败

- `windows-full-final/`、`windows-full-final.log`：在重负载任务结束后串行执行的最终 Windows 全量。
- `windows-infrastructure-accepted/`、对应日志：全量通过后串行执行的 Windows 真实 MySQL/Redis/Chroma 与承接门禁。
- `windows-lifecycle.json` / `windows-lifecycle.log`：干净源码副本的全新 Python 安装和 PowerShell 生命周期；原 `.runtime` 未覆盖。
- `scanner-final.xml` / `scanner-final.log`：当前扫描 11 项，含审查发现缺口的反例；`red-review-scan.log` 保留新增 4 项修复前失败。
- `images.json`、四份 `linux-*-build.log`：删除后的镜像构建（固定依赖层允许命中缓存）。
- `linux-no-jvm.json` / `linux-no-jvm.log`：无 Java/Maven/JVM 目录、CPU 模块构造。构造输出不是实际模型分类。
- `linux-algorithms.xml` / `linux-algorithms.log`：306 通过、1 跳过、16 deselected，来自无 Java 的独立源码副本；`generate_proto.py` 使用独立 contracts。
- `compose/results.json`、`compose/compose-login.png`：实际原 Vue/Nginx/纯 Python API/Worker、留存数据和会话、地址重新发现通过；容器与卷仅属于随机本次项目。
- `linux-clock.json`：30 秒只读观测出现约 2.8 秒回拨；不修改生产保护、系统时钟或业务租约。
- `windows-full/`：首轮 808 通过、2 个 Worker 启动预算失败、43 跳过；并发重负载期间发生启动超时，资源争用为可能原因；失败保留。
- `windows-infrastructure/` 与 `windows-infrastructure-final/`：前两轮启动/Worker 执行预算失败，保留原机器结论及其私有运行目录，不覆盖为最终结果。
- `linux-full/`：首轮在失败后受控 SIGINT 终止，293 通过、3 失败、27 跳过，不是全量 PASS。失败包括 445ms 时钟回拨保护、就绪探针时限、人工等待断言；`linux-diagnosis.xml` 只代表相关文件 5 项单独复验通过。
- `linux-infrastructure/`：首次 MySQL 尚未就绪；`linux-infrastructure-final/`：Worker 两项执行时限失败，不记 PASS。

初轮用户在 11:57 停止 Docker 并要求暂不再启动，所以下列旧结果当时为 PARTIAL。该限制随后由明确授权解除；本次新增 Web 814/43、真实基础设施 gates 与承接 21 通过，临时停止的 Ubuntu 时间同步已恢复 active/enabled。用户之后要求不再继续 Linux 验收，不追加运行。失效 socket 已备份，Docker/WSL 配置和数据未重置。

`preexisting.patch`、`preexisting-status.txt`、`claude-index.txt` 是本地私有操作辅助文件，不提交。已存在的旧票证据、SQL、运行目录、业务数据和他人修改不清理。

共享验收器沿用工单 06 的内部 ticket 字段与隔离库前缀；本票以 2026-10-17 时间戳、新随机运行目录、源码摘要和本票输出路径区分。原始输出不重写编号。

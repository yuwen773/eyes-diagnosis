# 08 — 历史留存、Java 移除与最终验收

**What to build:** 前置替代能力与演练通过后，核验含 Java 的历史标签和已保全 SQL，移除主目录 Java/构建依赖，再验证最终交付与数据恢复。

**Blocked by:** 07 — 维护窗口切换与故障恢复演练。

**Status:** ready-for-human

**内部实施顺序:** 先核验历史与删除清单，再删除，最后重验；退出门槛独立保留，不能因前面合并工单而提前删除 Java。

**Acceptance criteria:**

- [x] 核验 Git 标签可定位含完整 Java 与旧构建的历史，所需 SQL 已按原字节保全；不通过删除资源或旧证据“修好”测试。
- [x] 按活跃依赖清单移除 Java 源码、Maven/Java 构建配置与探针、Tika/JVM 安装执行残留；当前指引无 Java 操作，历史文档与旧证据仍可识别。
- [x] 删除后重新执行适用工程、依赖扫描、Windows 工具/开发入口及干净 Linux 无 JVM 构建/CI/真实基础设施门禁，证明测试不读取已移除源文件。（工程范围；Linux 临时时间同步停服条件单列。）
- [x] 原数据、四类等待恢复、旧任务视图与关联重建无损，最终报告区分“去 Java 工程完成”、未执行的生产切换与真实供应商/模型/临床阻塞；不清理业务库、运行文件或他人修改。

**Verification:** 删除后的依赖扫描、Windows 开发/工具、Linux 构建/CI/真实基础设施及数据恢复验证；不默认 push 或部署。

**Spec:** [完整去 Java 的 Python 项目迁移](../spec.md)。

**Acceptance mapping:** Q1、Q2、Q3、Q5、Q7、Q11。

**Worktree:** `D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。

**Verification status:** PASS_WITH_LIMITATIONS — 4/4 工程判据完成，待人工复核。Windows 证据按未变更实现复核；新增 Linux 全量 814/43、真实服务工程 gates 和数据库承接 21 通过。Linux 验证临时停止 Ubuntu 时间同步且结束恢复，不代表默认 WSL 环境已修复；用户要求不再继续 Linux 验收。

## 实施与验收（2026-10-17）

- 07 的 80 项已提交源码/证据摘要和三份最终 JUnit 已核验；24 份 SQL 的捕获字节、长度与原 Git blob 来源逐项一致。
- 本地附注标签 `archive/java-before-python-retirement-2026-10-17` 固定到 `3eff16390721b4d8b5a36b6623d2bb0981b8a441`。按清单仅移除 203 个已跟踪 Java/旧构建文件；SQL、旧证据、忽略运行文件及他人修改保留。
- 原 Java 演练测试按原内容归档为 `.py.txt`，当前测试不再提供 Java 旧槽执行入口。README/AGENTS 使用 Python 指引；CLAUDE.md 的既有修改保留在明确标注的历史区。
- 命令行依赖门禁覆盖当前源码、脚本、Dockerfile、CI、当前文档命令和前端 package scripts；11 项反例/正例通过，Standards/Spec 两轴复审各 0 项。
- Windows 删除后串行 Web 全量 **814 通过、43 跳过、1 条既有警告**，7 文件类型检查、134 包依赖与冻结基线通过。
- 已完成 Windows 干净源码安装和 PowerShell 生命周期、前端 49 项、真实旧 Python 四类等待升级与旧任务并发关联重建 12 项；Linux 镜像/CPU 工程检查、306 项算法回归和原 Vue Compose 登录/重启/地址重新发现通过。
- 首轮 Windows/Linux 组合验证有启动/执行预算失败，Linux 还捕获 445ms 回拨；30 秒独立观测记录约 2.8 秒回拨。失败与阶段性结果原样保留，生产时钟保护、业务租约和恢复断言未修改。
- 用户确认主动停止 Docker，并要求暂不再启动。Linux 首轮 Web 在失败后受控终止、真实基础设施门禁失败，最终全量/基础设施不记 PASS；未调整共享 WSL 时钟或操作其他数据库服务。
- 生产业务库升级、生产切流、托管 CI、真实 embedding/LLM/分类/COS 和临床均未执行/验收；不 push。

Windows 最终真实基础设施主链通过：11 项 HTTP/身份/文档/工作流检查，14 项真实 MySQL 并发、12 项等待重启及 21 项数据库承接全部通过。供应商/模型/临床边界仍未验收。

最终 Windows 串行结果和机器计数登记于 [汇总](../evidence/issue08/verification-summary.json)。
[删除与保全清单](../evidence/issue08/deletion-plan.json)；[证据索引](../evidence/issue08/README.md)；[当前指引](../../../docs/python-retirement.md)。

## 本次收尾

用户允许启动 Docker，并进一步允许临时停止 Ubuntu `systemd-timesyncd`、结束恢复。原环境全量 808 通过、6 失败、43 跳过；5 项直接报 ID 回拨，1 项 Worker 领取失败。原结果完整保留，不改生产保护或测试断言。

同实现/同测试在临时时间同步停服条件下 Web 全量 814 通过、43 跳过、1 条既有警告；隔离真实 MySQL/Redis/Chroma 的 infrastructure、orchestration、mysqlSemantics 均 PASS，数据库承接 21/21。共同入口退出 0，时间同步已恢复原 active/enabled 状态。细分并发日志仍保留在本次运行卷，未在引擎关闭后重新启动 Docker 导出；不额外声称主机已有这些细分日志。

用户随后要求不再验收 Linux，后续不追加该项操作；已有结果作为附环境条件的工程证据保留。最终机器汇总、旧 PARTIAL 快照与恢复记录见 [收尾索引](../evidence/issue08/closeout-20261017/README.md)。旧工单 19/20/21 的阻塞不因此关闭；生产、真实供应商/模型和临床仍独立。

## Constraints

- 依赖工单完成后方可实施；ready-for-agent 表示定义就绪，不代表当前无阻塞或验收通过。
- 兼容优先，旧缺陷另列；医生复核、冻结 AI 来源与用户保存授权分别保留。
- 不清理业务数据、原有运行文件或他人修改；原 spec、旧迁移记录与证据保留历史身份。
- 原 Java 活跃资产保留到工单 08 的前置替代能力与切换演练通过；由 08 执行受控移除并重新验收，不由前置工单提前删除。
- 在隔离环境验证，不默认执行真实业务库升级、生产切流、远端发布或推送；受控、真实基础设施、真实模型/供应商及临床结果分开报告。

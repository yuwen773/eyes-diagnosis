# 08 — 历史留存、Java 移除与最终验收

**What to build:** 前置替代能力与演练通过后，核验含 Java 的历史标签和已保全 SQL，移除主目录 Java/构建依赖，再验证最终交付与数据恢复。

**Blocked by:** 07 — 维护窗口切换与故障恢复演练。

**Status:** in-progress

**内部实施顺序:** 先核验历史与删除清单，再删除，最后重验；退出门槛独立保留，不能因前面合并工单而提前删除 Java。

**Acceptance criteria:**

- [x] 核验 Git 标签可定位含完整 Java 与旧构建的历史，所需 SQL 已按原字节保全；不通过删除资源或旧证据“修好”测试。
- [x] 按活跃依赖清单移除 Java 源码、Maven/Java 构建配置与探针、Tika/JVM 安装执行残留；当前指引无 Java 操作，历史文档与旧证据仍可识别。
- [ ] 删除后重新执行适用工程、依赖扫描、Windows 工具/开发入口及干净 Linux 无 JVM 构建/CI/真实基础设施门禁，证明测试不读取已移除源文件。
- [x] 原数据、四类等待恢复、旧任务视图与关联重建无损，最终报告区分“去 Java 工程完成”、未执行的生产切换与真实供应商/模型/临床阻塞；不清理业务库、运行文件或他人修改。

**Verification:** 删除后的依赖扫描、Windows 开发/工具、Linux 构建/CI/真实基础设施及数据恢复验证；不默认 push 或部署。

**Spec:** [完整去 Java 的 Python 项目迁移](../spec.md)。

**Acceptance mapping:** Q1、Q2、Q3、Q5、Q7、Q11。

**Worktree:** `D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。

**Verification status:** PARTIAL — 历史保全和受控 Java 移除已实施；3/4 判据完成。Linux 最终全量/真实基础设施未闭环，用户明确要求保持 Docker 停止，整票不标记 PASS。

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

## Constraints

- 依赖工单完成后方可实施；ready-for-agent 表示定义就绪，不代表当前无阻塞或验收通过。
- 兼容优先，旧缺陷另列；医生复核、冻结 AI 来源与用户保存授权分别保留。
- 不清理业务数据、原有运行文件或他人修改；原 spec、旧迁移记录与证据保留历史身份。
- 原 Java 活跃资产保留到工单 08 的前置替代能力与切换演练通过；由 08 执行受控移除并重新验收，不由前置工单提前删除。
- 在隔离环境验证，不默认执行真实业务库升级、生产切流、远端发布或推送；受控、真实基础设施、真实模型/供应商及临床结果分开报告。

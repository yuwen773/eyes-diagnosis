# 01 — Python 数据库迁移与数据保全基线

**What to build:** 建立独立契约、SQL 摘要和恢复样本基线，再打通无 JVM 的空库初始化与旧库承接，让 Python API 在两类已验证数据库上可启动并读取原数据。

**Blocked by:** None — can start immediately。

**Status:** ready-for-human

**内部实施顺序:** 先冻结基线，再验证空库，最后验证旧库承接；三步在同一工单内分段验证，不单独跟踪。

**Acceptance criteria:**

- [x] 冻结旧业务与新工作流的独立契约，覆盖业务封装、Long/分页/日期、登录失效与 SSE；契约样本不包含密码、哈希、真实个人数据或供应商内容。
- [x] 为旧 SQL、bootstrap callback 和历史 schema 定义建立原字节摘要与清单；列明活跃的 Java/JVM、Maven、Tika、源码读取测试、验收脚本与当前运行说明依赖。
- [x] 准备三类诊断数据和四类 Python 人工等待的合成样本定义，明确稳定 ID、归属、来源、批准与审计不变量；记录导出图及独立聊天补充版本的恢复约束。
- [x] 基线准备阶段的独立契约/摘要检查可运行并报告差异；此阶段只扩展基线，不替换生产路径、不改原 Java/旧 SQL/历史 spec，也不将基线结果宣称为迁移完成。
- [x] 初始化在无 JVM 环境执行，覆盖旧 SQL/callback 的必要效果和已确认 schema，原 SQL 字节与摘要不改变。
- [x] 新迁移链使用独立历史；初始化、重复执行和后续增量升级行为明确，并发升级受控，不靠 API/Worker 启动时执行 DDL。
- [x] 真实空 MySQL 初始化后 API 健康与可用的公开业务入口通过 HTTP 验证；关键 camelCase 列、约束和版本信息可核验。
- [x] 中断或失败的升级被明确识别，不误登记成功或无条件重放非幂等 DDL；证据来自隔离新库，不操作业务库。
- [x] 明确并验证支持的旧库起点，包括代表性旧库与 V22 快照；每条最终交付路径均无需 JVM，未知状态停止并列差异。
- [x] 核验原版本、checksum、schema 和失败历史后才承接；不重放已应用 DDL，不自动修复 V8/未知 checksum，不删除或改写原历史。
- [x] 升级后稳定 ID、数据数量/内容、归属关系、AI 来源、医生复核、保存授权及现有 Python 等待输入/checkpoint 均符合基线。
- [x] 验证无变化重复运行、升级失败/中断与基线登记原子边界；输出可审计的安全结果，不泄漏账号哈希或连接秘密。

**Verification:** 独立契约/摘要检查 + Python 升级 CLI → 隔离真实 MySQL → API；覆盖初始化、重复执行、历史漂移与失败边界。

**Spec:** [完整去 Java 的 Python 项目迁移](../spec.md)。

**Acceptance mapping:** Q1、Q2、Q3、Q5、Q13。

**Worktree:** `D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。

**Verification status:** PASS（工单 01 支持范围）— Windows / Python 3.11.17 / MySQL 8.0.26；专项 28 passed，完整 Web 726 passed / 24 skipped，类型检查通过，Standards/Spec 复核问题均已关闭。

支持空库、完整冻结 V9 和 V22 配置；MySQL 5.7、未知结构/历史明确拒绝。四类人工等待在 V22 承接前持久化、承接后跨 API/Worker 进程恢复；身份、模型、检索是合成适配器，不代表真实 Redis 登录、供应商或临床验收。Linux 实测、生产升级/切流及全项目去 Java 尚未执行。

使用说明：[Python 数据库承接](../../../deploy/python-migrations/README.md)。逐项证据及审查闭环：[验收记录](../../../docs/python-database-handoff-evidence.md)。机器结果：[results.json](../evidence/issue01/results.json)。

## Constraints

- 依赖工单完成后方可实施；ready-for-agent 表示定义就绪，不代表当前无阻塞或验收通过。
- 兼容优先，旧缺陷另列；医生复核、冻结 AI 来源与用户保存授权分别保留。
- 不清理业务数据、原有运行文件或他人修改；原 spec、旧迁移记录与证据保留历史身份。
- 原 Java 活跃资产保留到工单 08 的前置替代能力与切换演练通过；由 08 执行受控移除并重新验收，不由前置工单提前删除。
- 在隔离环境验证，不默认执行真实业务库升级、生产切流、远端发布或推送；受控、真实基础设施、真实模型/供应商及临床结果分开报告。

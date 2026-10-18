# 完整去 Java：本地工单索引

发布日期：2026-10-15（Asia/Shanghai）。
用户已确认整体方案，并明确要求“就按这 8 张拆分，生成正式的本地工单”。
状态（2026-10-17 收尾更新）：01–08 均已在各自工程支持范围交付，ready-for-human；08 为 PASS_WITH_LIMITATIONS、4/4。用户不再要求继续 Linux 验收，已有完成证据保留；真实模型/供应商、临床与生产发布边界独立。

规范入口：[spec.md](spec.md)。已确认拆分及原草案合并映射：[ticket-breakdown.md](ticket-breakdown.md)。
工作位置：`D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。
本阶段使用独立编号，不替换旧 Python Agent 迁移工单，也不修改旧工单 19/20。

## 工单与依赖

| 编号 | 工单 | Blocked by | Status | 验收判据 |
|---|---|---|---|---|
| 01 | [Python 数据库迁移与数据保全基线](issues/01-python-database-handoff.md) | None | ready-for-human | 12/12 |
| 02 | [Python 登录鉴权与前端接线](issues/02-python-session-auth.md) | 01 | ready-for-human | 4/4 |
| 03 | [非 JVM 文档解析与知识库闭环](issues/03-no-jvm-document-knowledge.md) | 02 | ready-for-human | 8/8（支持范围） |
| 04 | [旧版任务查看与显式关联重建](issues/04-legacy-workflow-rebuild.md) | 02 | ready-for-human | 8/8（支持范围） |
| 05 | [现有 Python 任务升级与重启恢复](issues/05-python-wait-recovery.md) | 02 | ready-for-human | 4/4（支持范围） |
| 06 | [Python 工程、双环境部署与无 JVM CI](issues/06-python-project-deploy-ci.md) | 03、04、05 | ready-for-human | 8/8（工程支持范围） |
| 07 | [维护窗口切换与故障恢复演练](issues/07-cutover-recovery-rehearsal.md) | 06 | ready-for-human | 4/4（Windows 隔离工程范围） |
| 08 | [历史留存、Java 移除与最终验收](issues/08-retire-java-final-verification.md) | 07 | ready-for-human | 4/4（工程范围；Linux 结果附环境条件） |

## 当前可执行前沿

**01–08** 已交付待人工复核。08 已完成历史保全、活跃 Java 移除及工程收尾；Windows 证据复核通过，新增 Linux 全量与真实基础设施结果已落盘。Linux 通过条件为用户授权临时停止 Ubuntu 时间同步，结束后已恢复 active/enabled；不代表默认 WSL 回拨问题永久修复。用户要求不再继续 Linux 验收，不追加该项操作。见 [工作树整体进度](../../docs/python-worktree-progress.md) 和 [08 当前证据](evidence/issue08/README.md)。

依赖顺序：01 → 02 → {03、04、05} → 06 → 07 → 08。
所有工单的 `ready-for-agent` 表示定义就绪；执行前仍须检查其 Blocked by 是否完成。已交付工单的实际验证边界见各自验收记录，不以 ready-for-human 状态本身替代真实模型、部署或临床验收。

## 跟踪与验收

- 工单粒度已经确认，后续以逐张工单为实施和状态更新单位，内部步骤可分段验证。
- 当前 01–08 保持各自支持范围结论；托管 CI、生产业务库升级、生产切流和 push 均未执行。以下前置工单记录保留其交付当时的边界，不改写历史失败。
- 07 完成固定旧槽产物、统一停写网关、停领取/在途租约处理、一致性备份及独立恢复库核验、写入前实际退旧槽和写入后止写/Python 修复。首次连续停写 34.578 秒，故障后修复验证 19.985 秒；Windows Web 全量 803 通过、44 跳过、1 条警告，真实 Nginx 5 项及最终隔离演练通过，两轴复审各 0 项。见 [07 验收汇总](evidence/issue07/verification-summary.json)。真实供应商/模型、临床、Linux 切换、托管 CI 和生产切换未据此通过；Java/SQL 保留，未启动 08。
- 06 完成根目录 Python 工程、Windows PowerShell 生命周期、Linux 无 JVM Web/CPU/验证镜像、原 Vue Compose 和活跃 CI 替代。Windows/Linux Web 全量各 801 通过、40 跳过；前端 49、浏览器恢复 4、CPU 算法 306、watchdog 28 通过，真实 MySQL/Redis/Chroma 主链及两环境各 14 并发、12 等待恢复、21 承接通过；两轴复核剩余 0 项。见 [06 验收汇总](evidence/issue06/verification-summary.json)。托管 CI、真实模型/供应商、临床、生产切流及 Ubuntu 集成代理报错修复均未据此宣称通过；原 Java 资产保留，未启动 07/08。
- 05 完成四类现有 Python 等待的固定旧代码样本、升级与真实身份跨进程恢复、原 Vue 刷新、版本拒绝及真实 MySQL 租约/fencing；真实 MySQL/Redis/UI 专项 11 通过，Windows Web 全量 797 通过、40 跳过，前端 49 通过，两轴复核剩余 0 项。见 [05 证据汇总](evidence/issue05/verification-summary.json)。外部模型/检索/解释为受控适配，真实模型/供应商、临床、Linux 全量/部署及生产切流不在本次验收范围。
- 04 的 Windows 最终 Web 全量 794 通过、29 跳过，前端构建及 49 项测试、Linux 相关 15 项、隔离真实 MySQL 六路并发重试及原 Vue 浏览器 6 项验证通过；Standards/Spec 剩余 0 项。首轮测试进程生命周期失败及修复复验分开留存；见 [04 证据汇总](evidence/issue04/verification-summary.json)。真实模型/供应商、临床、生产切流与 Linux 全量/部署不在本次验收范围。
- 03 的 Windows 最终全量 787/28、Linux 最终相关回归 104/1 通过；Linux 全量仍有 5 项失败。真实 embedding 历史 HTTP 401 阻塞保留，COS 为受控边界；见 [03 证据汇总](evidence/issue03/verification-summary.json)。
- 验证结果按工程、真实基础设施、真实模型/供应商和临床分别记录；新阶段验收不得改写旧工单的阻塞证据。
- 08 的 Windows 最终全量 814 通过、43 跳过；真实基础设施主链、14 并发、12 等待重启、21 承接，以及独立旧版升级/重建 12、前端 49 通过。本次复用未改实现的 Windows 证据；新增 Linux 全量 814/43、真实 MySQL/Redis/Chroma 三个工程 gate 及数据库承接 21 通过，条件与恢复记录独立登记。见 [08 汇总](evidence/issue08/verification-summary.json)。
- 08 为 PASS_WITH_LIMITATIONS：52 条工程判据按各票支持范围登记完成，不扩大为真实模型、供应商、临床、默认 WSL 环境修复或生产放行。

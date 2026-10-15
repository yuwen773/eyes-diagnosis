# 完整去 Java：本地工单索引

发布日期：2026-10-15（Asia/Shanghai）。
用户已确认整体方案，并明确要求“就按这 8 张拆分，生成正式的本地工单”。
状态：8 张正式本地工单已发布；01 已实施并完成其支持范围的验证，状态 ready-for-human；其余 7 张尚未实施。

规范入口：[spec.md](spec.md)。已确认拆分及原草案合并映射：[ticket-breakdown.md](ticket-breakdown.md)。
工作位置：`D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。
本阶段使用独立编号，不替换旧 Python Agent 迁移工单，也不修改旧工单 19/20。

## 工单与依赖

| 编号 | 工单 | Blocked by | Status | 验收判据 |
|---|---|---|---|---|
| 01 | [Python 数据库迁移与数据保全基线](issues/01-python-database-handoff.md) | None | ready-for-human | 12/12 |
| 02 | [Python 登录鉴权与前端接线](issues/02-python-session-auth.md) | 01 | ready-for-agent | 4 |
| 03 | [非 JVM 文档解析与知识库闭环](issues/03-no-jvm-document-knowledge.md) | 02 | ready-for-agent | 8 |
| 04 | [旧版任务查看与显式关联重建](issues/04-legacy-workflow-rebuild.md) | 02 | ready-for-agent | 8 |
| 05 | [现有 Python 任务升级与重启恢复](issues/05-python-wait-recovery.md) | 02 | ready-for-agent | 4 |
| 06 | [Python 工程、双环境部署与无 JVM CI](issues/06-python-project-deploy-ci.md) | 03、04、05 | ready-for-agent | 8 |
| 07 | [维护窗口切换与故障恢复演练](issues/07-cutover-recovery-rehearsal.md) | 06 | ready-for-agent | 4 |
| 08 | [历史留存、Java 移除与最终验收](issues/08-retire-java-final-verification.md) | 07 | ready-for-agent | 4 |

## 当前可执行前沿

**01 — Python 数据库迁移与数据保全基线** 已交付待人工复核。依赖链下一张为 **02 — Python 登录鉴权与前端接线**；本次没有自动实施后续工单。

依赖顺序：01 → 02 → {03、04、05} → 06 → 07 → 08。
所有工单的 `ready-for-agent` 表示定义就绪；执行前仍须检查其 Blocked by 是否完成。工单 01 的真实 MySQL 与受控恢复证据见其验收记录，不以 ready-for-human 状态本身替代验收。

## 跟踪与验收

- 工单粒度已经确认，后续以逐张工单为实施和状态更新单位，内部步骤可分段验证。
- 当前完成工单 01 的数据库基线、纯 Python 升级 CLI 及隔离真实 MySQL/API/Worker 验证；没有创建历史标签、移除 Java、触发托管 CI、升级业务库、切流或推送。
- 验证结果按工程、真实基础设施、真实模型/供应商和临床分别记录；新阶段验收不得改写旧工单的阻塞证据。
- 工单 08 只能在前置替代能力与切换演练通过后实施，删除后仍须重新验证无 JVM 的最终交付。

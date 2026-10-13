# 02 — 跑通上传任务的持久执行最小闭环

**What to build:** 用户从上传页创建诊断任务，得到任务标识和可查询的进度；实际 Python Worker 执行 LangGraph，服务重启后仍可查看并继续原任务。

**Blocked by:** 01 — 建立可复现的现有 FastAPI 业务基线。

**Status:** completed

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-01、AC-02、AC-12、AC-22；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [x] 新异步入口返回 202 与任务标识；同用户同幂等请求不重复创建，跨用户查询被拒绝。
- [x] 有实际注册的可执行图与生产 Worker，从任务创建、排队、执行到明确终态可通过 HTTP 演示；不能只有测试代码能组图。
- [x] 最小流程以真实输入验证或明确不可用终态结束；尚未接入的诊断能力不伪造 COMPLETED 或解释发布。
- [x] MySQL 保存业务状态、版本与任务，checkpoint 可跨实例恢复；图定义唯一决定路由，Worker 不复制路由表。
- [x] 版本化升级资产可复现部署，沿用统一迁移治理，不修改 Java 或旧迁移历史，也不由 Web 启动自动建表。
- [x] 上传页可展示服务端任务状态，重建应用后同一任务仍可查询；锁定经验证的 Python/LangGraph 兼容依赖。

## Verification

通过创建/查询 API 与最小上传页面验证，重建进程并复用 MySQL；可控动作只用于工程测试，不能冒充模型结果。

2026-10-13 完成：Python 428 项、前端 13 项测试通过，类型检查和构建通过；
隔离 MySQL、原 Java 与真实 HTTP/Worker/浏览器链路 11 项检查通过。
交付和边界见 [实现与验证报告](../../../docs/durable-upload-workflow.md)，
双轴复审均无遗留问题，见 [审查记录](../../../docs/workflow/issue02-review.md)。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。

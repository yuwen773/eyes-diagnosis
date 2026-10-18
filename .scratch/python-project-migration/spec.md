# 完整去 Java 的 Python 项目迁移：规范入口

日期：2026-10-15（Asia/Shanghai）。
状态：整体设计与 8 张工单拆分均已获用户确认；工单已发布，实施尚未开始。

完整规范以 [已确认设计](../../docs/plans/2026-10-15-complete-python-migration-design.md) 为准，不在此复制，以避免多份规范漂移。
决策见 [ADR 0001](../../docs/adr/0001-complete-python-migration.md)，领域语言见 [CONTEXT.md](../../CONTEXT.md)。

## 已确认的主要边界

- 保留 Vue、现有账号密码、稳定 ID、业务数据与任务来源；后端和开发/测试/升级/部署/运行链路均无需 JVM。
- Python 接管 Cookie/Redis 登录态，切换后允许重新登录；旧 SQL/Flyway 历史冻结，核验后由 Python 新迁移链承接。
- 支持 Windows 开发与 Linux Compose/CI；允许固定且可验证的非 JVM DOC 工具。
- 现有 Python 等待任务须恢复；旧 Java 任务只读保留，用户确认后可关联重建，不继承旧批准。
- 先完成替代、真实基础设施与切换演练门槛，再保留历史标签并移除活跃 Java；真实模型/供应商和临床结果独立记录。
- 本次工单发布不执行生产切流、真实业务库升级、Java 删除或远端发布。

工单、依赖和当前前沿见 [README.md](README.md)。

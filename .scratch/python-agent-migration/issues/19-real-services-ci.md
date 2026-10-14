# 19 — 完成真实基础设施和旧接口兼容验收

**What to build:** 在真实 MySQL、Redis、Chroma 和 Java 会话服务上运行 Python 完整用户流程与兼容回归，形成可重复执行的集成验证入口。

**Blocked by:** 07 — 补齐 .doc 与表格型 .docx 的上传检索；13 — 让聊天按需查询带来源的历史诊断；17 — 验证所有人工等待流程跨重启恢复；18 — 统一聊天和诊断事件并恢复断连界面。

**Status:** ready-for-agent

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-02、AC-15、AC-17、AC-18、AC-19、AC-22；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [ ] 集成验证真实经过 API、持久化与 Worker，不用 SQLite 替代 MySQL 事务、租约、版本冲突和受影响行数。
- [ ] 真实 Java 会话服务验证登录、登出与鉴权失效；数据库升级后原 Java 服务仍可启动。
- [ ] 真实 Chroma 与 embedding 验证文档上传、范围过滤、引用和检索，过渡期验证旧 Java 读端，最终验证 Python Agent 读取。
- [ ] 旧业务与 Agent 契约全面回归，新工作流 202/状态/审批契约单独验证，不强套旧 HTTP 200 规则。
- [ ] 自动化入口在无外部凭据或服务时明确报告未验证/阻塞，实测证据与模拟模型结果分开记录。
- [ ] 复核实际生产图注册与 Worker 调用链；权限和状态约束通过集成接口验证。

## Verification

真实基础设施集成；LLM/分类可用确定性适配器覆盖编排，但真实 embedding/分类未实测不得宣称对应能力完成。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。


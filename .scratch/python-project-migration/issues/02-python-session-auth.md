# 02 — Python 登录鉴权与前端接线

**What to build:** 用户以原账号密码登录，Cookie 会话由 Python/Redis 管理，Vue 与受保护 HTTP/SSE 不再调用 Java 身份服务。

**Blocked by:** 01 — Python 数据库迁移与数据保全基线。

**Status:** ready-for-human

**内部实施顺序:** 在同一切片内完成会话端点、集中鉴权、路由、OpenAPI 与浏览器验证。

**Acceptance criteria:**

- [x] 三个会话端点、集中鉴权、路由和前端接线走 Python；旧 Spring Cookie 不获得新登录资格，Redis 使用独立会话空间，不读取 Java 序列化对象。
- [x] 保留 BCrypt/遗留 MD5 校验与升级语义，原密码可用；登录会话轮换，Cookie 属性与开发/部署配置明确，响应及日志不含密码/哈希。
- [x] 真实 Redis 验证登出、过期、删号、角色变化、会话重放与服务异常；受保护 HTTP/SSE 拒绝越权，不因 Redis 不可用放行。
- [x] 原用户重新登录后可访问原数据；Vue 登录/退出/失效引导及旧业务、新工作流错误契约保持各自约定，OpenAPI 生成来源切换为 Python 并通过构建。

**Verification:** 真实 MySQL/Redis + TCP API 身份生命周期及隔离；浏览器登录/退出/失效和原数据读取。

**Spec:** [完整去 Java 的 Python 项目迁移](../spec.md)。

**Acceptance mapping:** Q4、Q5、Q12。

**Worktree:** `D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。

**Verification status:** PASS（工单 02 支持范围）— Windows / MySQL 8.0.26 / Redis 3.2.100；最终完整 Web 778 passed / 28 skipped，前端构建及 47 项回归通过，真实 TCP 身份生命周期和原 Vue 登录/退出/过期/原数据读取通过。Java 未启动、src/pom 零改动。

Standards/Spec 复核发现已关闭。7 个核心模块 mypy 通过；业务 router 的 10 处既有类型错误已与 HEAD 原文件对照，未扩展本票修复范围。真实模型/供应商、临床、Linux、生产切流/升级/回退与 Java 移除未验收。历史大场景验证脚本已更新并编译，未由本票重跑全部旧演练。

[验收记录](../../../docs/python-session-auth-evidence.md)；[机器结果](../evidence/issue02/results.json)；[汇总](../evidence/issue02/verification-summary.json)。

## Constraints

- 依赖工单完成后方可实施；ready-for-agent 表示定义就绪，不代表当前无阻塞或验收通过。
- 兼容优先，旧缺陷另列；医生复核、冻结 AI 来源与用户保存授权分别保留。
- 不清理业务数据、原有运行文件或他人修改；原 spec、旧迁移记录与证据保留历史身份。
- 原 Java 活跃资产保留到工单 08 的前置替代能力与切换演练通过；由 08 执行受控移除并重新验收，不由前置工单提前删除。
- 在隔离环境验证，不默认执行真实业务库升级、生产切流、远端发布或推送；受控、真实基础设施、真实模型/供应商及临床结果分开报告。

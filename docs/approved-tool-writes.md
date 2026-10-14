# 工单 15：Agent 业务操作确认

实施目录：`.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。
实施前 HEAD：`85645b1f23ba7df59b8f4968509b080e4a141f94`。

## 行为

用户在聊天要求修改本人简介，模型调用 `propose_profile_update` 提出意图。
服务端只接受 `userProfile` 字符串（最多 512 字符）；用户 ID、角色、授权标记
和其他字段不能由模型指定。目标始终是 Java 本次认证用户。

沿用工单 11 的冻结内容、SHA-256 绑定、30 分钟数据库时间有效期、独立批准/
拒绝、事务回执与重放原则，并复用其 canonical 序列化。通用资料操作独立存入
`t_agent_tool_confirmation`，不混用医生复核任务或诊断保存记录。
工单 11 的保存接口、发布条件和临床门禁保持原行为。

聊天确认卡展示目标、修改前后简介、操作来源、有效期和当前状态。批准只提交
所见确认 ID、创建幂等键和内容摘要；不再次提交新资料。拒绝不修改用户数据。
刷新页面或恢复 API 后从数据库读取确认和回执。历史聊天/进度/审计继续自动保存。
待确认卡优先显示；窄屏在视口底部展示，避免被既有侧栏挤压。

## 授权与事务

冻结快照包含用户、操作类型、当前资料及编辑/更新时间、角色、新简介、
工具身份与版本、适配器版本。批准重新经 Java 验证身份，并锁定资料、检查归属、
逻辑删除、角色及当前完整资料版本。任何不匹配不执行修改。
批准、用户更新和回执在同一事务提交；失败全部回滚，仍可重试。

确认状态和业务更新均带条件更新。过期或失效更新也仅允许从 PENDING 转换，
不会用旧请求覆盖已提交的 APPROVED 回执。重复批准只返回原回执，不能覆盖后来
经旧资料页修改的内容。每轮聊天运行 ID 是操作幂等键；相同键不能绑定新参数或工具。

## MCP 登记

默认不开放 MCP 资料写操作。部署管理员可配置：

```text
MCP_PROFILE_TOOLS=<用户服务代码>/update_my_profile
```

多个登记以逗号分隔。只支持 `update_my_profile` 到本地本人简介适配器的固定映射。
工具参数还须通过该 MCP 服务的输入 schema 校验和本地严格 DTO 校验。
该工具不执行远端 `tools/call`，业务效果由本地 MySQL 事务产生，避免跨系统写入
重试的不确定性。其他远端副作用操作尚未接入，不会因模型请求自动获得执行能力。

发现和批准时均检查服务归属、启用状态、连接策略和登记。确认绑定工具完整声明
及服务连接配置的指纹。批准重新发现工具，变更/撤销/不可用均使旧确认不能写入。
网络调用不持有 SQL 锁；重新发现完成后再次锁定服务归属和配置直到业务提交。
已知资料写工具始终禁止进入只读调用路径，包括发现后撤销写登记的情况。
既有只读工具继续要求管理员登记，远端 readOnlyHint 本身不授予权限。

## HTTP

接口沿用 Agent 的 `{code, data, msg}` envelope 和既有业务错误映射。

| 接口 | 行为 |
| --- | --- |
| GET `/api/agent/profile` | 读取当前用户简介，供效果核对 |
| GET `/api/agent/tool-confirmations?sessionId=...` | 当前用户/会话确认；读取时检查过期 |
| POST `/api/agent/tool-confirmations/{id}/approve` | 验证所见摘要及幂等键，批准并修改一次 |
| POST `/api/agent/tool-confirmations/{id}/reject` | 验证相同绑定，拒绝且不改资料 |

旧 `/api/user/update/userCenter` 等直接业务 API 没有静默添加确认或改变 DTO。
Java 三个会话端点仍由 Java 拥有；Java 源码、pom.xml 和源 spec 均未修改。

## 部署与验证范围

新增独立 Flyway 资产 `deploy/workflow-migrations/sql/V22__agent_tool_confirmation.sql`。
部署须先执行既有独立 Flyway 升级，再启用代码；应用启动不创建表。回退保留新增
确认表和回执，禁用本票代码/界面。未对真实 MySQL 执行 V22 升级。

本次提交只包含工单 15；当前 worktree 的前序工单 09–11 等未提交实现保留在原位，
包括所复用的确认模块。本次全套验证针对这个组合 worktree，不能等同于单独
checkout 本次提交后即可复现前序未提交实现。

HTTP/SSE 测试覆盖合法预览/批准/拒绝、过期、跨用户、参数/摘要/幂等键伪造、
资料/角色/适配器变化、MCP 版本/登记撤销、调用中撤销、写入异常回滚。
两个新 Python API 进程受控交错执行批准，再由新进程重放回执；SQLite 触发器
核对实际资料更新次数为 1。该结果不构成 MySQL 锁竞争验收。

Chromium 使用实际 Vue 聊天、HTTP/SSE 与磁盘 SQLite；Java 身份和模型为受控桩。
验证预览、拒绝、过期、批准、重放、跨用户、刷新恢复、窄屏和深色主题，脚本错误 0。
证据在 `.scratch/python-agent-migration/evidence/issue15/`，测试统计见对应日志。

结果：Python Web **682 passed / 1 skipped**（缺少隔离库 URL 的真实 MySQL 用例）；
本票 HTTP/MCP/双进程用例 **21 passed**。前端 **43 passed**，最终组件复验通过；
Vue 类型检查、生产构建及本票 Python 模块 mypy 均通过。标准/规格复核均无遗留项。
编译仍提示既有大 chunk，Python 仍提示 MCP fixture 的 lifespan 注解警告；不影响通过。

复现：在 algorithm 目录用 `.venv-baseline/Scripts/python.exe -m pytest web/tests -q`；
Java 子进程显式设置仓库指定 JDK 21。前端执行 `npm.cmd run test -- --run` 和
`npm.cmd run build`。根目录执行
`pwsh.exe -NoLogo -NoProfile -File algorithm/web/run_tool_writes_ui.ps1`。
浏览器脚本只启动并回收自己拥有且命令行已核对的测试进程。

真实 MySQL/Flyway、Java 会话服务、外部 MCP 服务、部署/回退和真实模型/临床
验收仍是独立门禁；本票不将受控验证扩展为这些门禁已通过。

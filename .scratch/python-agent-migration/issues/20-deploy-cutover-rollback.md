# 20 — 交付可复现部署、切流与回退演练

**What to build:** 维护者按交付说明启动所有服务，逐项切换业务与 Agent 路由，并能切回旧系统而不遗失任务或让两套 Worker 竞争执行。

**Blocked by:** 19 — 完成真实基础设施和旧接口兼容验收。

**Status:** ready-for-human（工程实现与隔离演练已交付；工单 19 的真实 embedding/旧 Java Long 检索阻塞仍保留）

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-19、AC-20、AC-21；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [x] 消除 Nginx 与 Java 端口冲突和代理回环，健康检查与鉴权转发均通过真实启动验证。
- [x] 启动说明包含 Python 依赖、文档解析外部依赖、Worker、数据库升级与 Java 会话配置；原 Java 源码和构建配置不变。
- [x] 业务接口切流、Agent 切流、数据库升级和执行器归属有明确步骤，回退不让新旧两套服务执行同一任务。
- [x] 旧端不具备新工作流能力时保留 Python 的查询或安全排空路径，明确继续/暂停策略，不把改路由等同于完整回退。
- [x] 演练中任务、待确认与复核记录不丢失；前端登录、上传、任务查看和聊天经过 Nginx 实测。
- [x] 记录回退条件、恢复步骤及证据；不在本票中未经授权发布生产部署。

## Verification

在隔离可复现环境演练数据库升级、全栈启动、分项切流和回退，保留任务与审批前后对照。

交付入口为 `python -m web.cutover`（仅生成配置）与原真实服务入口的
`--cutover-nginx <绝对路径>`。详见 `docs/deploy-cutover-rollback.md`。
新增恢复命名空间保留原 Python 聊天查询；pause 拒绝写入，drain 禁止新任务并保留
现有复核/补充/保存授权。Java 始终拥有三个会话端点。部署约定先停旧执行器，
Python Worker 仅领取 `python-graph`；禁止重标旧任务或将新图交给 Java。

真实 Nginx、Java 会话、MySQL/Flyway V1–V22、Redis、Chroma、API、独立 Worker
已经执行隔离演练：待保存确认、质量复核、最终复核和补充等待的切流前后快照一致；
恢复后原确认/复核继续，补充回复可幂等重放，医生复核不隐式保存。
浏览器通过真实 Nginx 登录、上传 202、刷新任务与聊天 SSE done，无网络拦截。
修正 Host 丢入口端口造成的 Java CORS 403，以及 SSE 绕过同源 API 配置的问题。

复核证据见 `.scratch/python-agent-migration/evidence/issue20/local/results.json`、
同目录源码/前端摘要与 `docs/deploy-cutover-review.md`。
真实模型、embedding、COS、临床、生产热切流和真实旧执行器交接各自保留未验收；
自动演练通过终止本次拥有的隔离代理再启动切换，不宣称无中断 reload 通过。
工单 19 仍 BLOCKED，本票工程交付不解除依赖阻塞，不代表整个 spec 或生产放行。

最终回归：Web 731 passed、24 skipped；前端 47 passed；真实 MySQL 并发 14 passed、
人工等待重启 12 passed。Python 类型检查与依赖一致性通过，前端类型检查/构建通过。
Standards/Spec 独立审查均 0 项。结果分层与摘要见同票 `regression.json`。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。


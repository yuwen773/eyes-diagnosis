# 01 — 建立可复现的现有 FastAPI 业务基线

**What to build:** 在迁移工作树启动现有业务服务，通过原前端完成登录后查询与既有业务操作，并形成可定位的兼容基线，作为后续 Agent 迁移的对照。

**Blocked by:** None — can start immediately。

**Status:** completed — 2026-10-12；基线说明与证据见 `docs/fastapi-baseline.md`，交付版本由 `git log -1 --format=%H -- docs/fastapi-baseline.md` 定位。

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-15、AC-19；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [x] 现有业务 API 契约清单以当前实现对账，覆盖返回封装、分页、Long/日期、权限和旧同步诊断行为，不沿用历史端点总数。
- [x] 通过 Java 保留的三个会话端点验证登录、鉴权转发和登出失效，前端能够完成一条真实业务查询。
- [x] 记录可复现的依赖、启动方式和回归结果；保留有效的忽略规则，迁移成果保存为可定位版本，不纳入 OMC 运行状态。
- [x] 原 Java 源码与构建配置保持不变；业务缺陷与迁移缺陷分别记录，不顺带修新闻等旧缺陷。
- [x] 权重缺失时验证诊断明确不可用，不以历史测试数字宣称真实模型验收通过。

## Verification

从 HTTP 与既有页面验证；接口回归可使用可控依赖，Java 登录态联通单独记录实测结果。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。


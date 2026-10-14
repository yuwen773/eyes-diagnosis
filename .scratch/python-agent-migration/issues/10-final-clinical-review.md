# 10 — 完成最终临床复核与受限发布

**What to build:** 医生在独立的最终临床复核任务中作出允许决策，用户随后看到正式解释或受限结果，复核不会重新生成已完成推理。

**Blocked by:** 04 — 完成图像质量人工复核与继续执行；09 — 生成并发布经校验的患者解释。

**Status:** ready-for-human（受控工程验证；真实服务与临床验收另行执行）

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-07、AC-11、AC-12、AC-21；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [x] 复用已有医生任务队列与权限基础，区分最终复核和质量复核，详情展示问题、推理来源、证据与解释版本。
- [x] 按有效预测和安全拒绝情形执行允许决策矩阵，校验领取人、权限与版本，禁止自审及不兼容决定。
- [x] 批准恢复正确图段，纠正或无法判断时扣留相应解释并按既有语义结束，不启动新检索循环。
- [x] 不覆盖 AI 来源、不更改图路由；重复提交仅产生一次决定和恢复效果。
- [x] 医生决定、解释发布/扣留及审计均可通过患者/医生 API 和页面观察，不能替代用户保存授权。

## Verification

通过真实路由和页面覆盖两类预测的决定矩阵、冲突、重复提交及结果展示；核对已有推理包不变。

工程结果：Python Web 559 passed / 1 skipped，其中最终复核 HTTP 18 passed；
前端 36 passed，mypy、Vue 类型检查、生产构建通过。Chromium 实际页面覆盖六种决定、409 冲突、
重放、刷新恢复、审计与发布/扣留，推理包和模型调用次数不变，页面脚本错误为零。
等待最终复核跨应用重建，安全拒绝提交后由独立 Worker 进程恢复验证通过。

报告：[`docs/final-clinical-review-workflow.md`](../../../docs/final-clinical-review-workflow.md)。
证据：`.scratch/python-agent-migration/evidence/issue10/`。
本次使用 SQLite 与受控 Java/COS/Chroma/embedding/模型，不代表真实服务或临床验收。
已有 MySQL 集成用例因未提供隔离库 URL 跳过；真实服务、模型、专业医生审查、部署和回退未验证。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。


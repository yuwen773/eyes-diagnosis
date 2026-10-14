# 09 — 生成并发布经校验的患者解释

**What to build:** 符合自动发布条件的任务展示可追溯解释；证据或声明不合格时展示限制，草稿不会作为正式结果泄露。

**Blocked by:** 08 — 完成审核参考资料到受控诊断检索的闭环。

**Status:** ready-for-human（受控工程验证；真实服务与模型验收另行执行）

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-07；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [x] 风险判断、解释生成、来源与声明校验均在实际任务链中执行，角色只能在职责内调用工具。
- [x] 解释区分模型评估、一般参考信息与风险提示，引用能定位真实受控片段，不宣称资料证明患者级概率。
- [x] 快照版本和 NONE/DRAFT/VALIDATED/PUBLISHED/REJECTED/WITHHELD 语义持久化；被拒绝或扣留的内容不能发布。
- [x] COMPLETED 具有已发布且已校验的解释；COMPLETED_LIMITED 不携带草稿或仅校验未发布的内容。
- [x] 自动发布路径可从上传到患者结果页演示；需最终临床复核的路径持久等待，不绕过复核。

## Verification

通过任务 HTTP 与患者页面测试可控模型的通过、证据不足和声明拒绝，不以直接测格式化函数代替。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。

## 实施与证据

实现、摘录式声明门、发布及撤回语义和真实验收边界见 `docs/validated-explanation-workflow.md`。
HTTP/浏览器证据见 `.scratch/python-agent-migration/evidence/issue09/`。
复用 V12 解释表，升级图/动作版本；旧 checkpoint 不静默恢复。
最终临床复核操作属于工单 10，正式诊断记录保存确认属于工单 11。


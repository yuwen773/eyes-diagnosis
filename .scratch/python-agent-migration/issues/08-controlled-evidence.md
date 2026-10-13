# 08 — 完成审核参考资料到受控诊断检索的闭环

**What to build:** 管理员为诊断参考资料设置受控属性和审核状态；诊断任务只使用符合范围的参考证据，不会把私人或隔离资料混入正式解释。

**Blocked by:** 03 — 接入 PyTorch 推理并执行质量门。

**Status:** ready-for-human（受控工程验证；真实服务与模型验收另行执行）

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-06、AC-18；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [x] 以必要管理入口与持久属性支持 CURATED_PUBLIC/PRIVATE_USER/QUARANTINED、审核状态及 diseaseCodes/topicCodes，默认不把未审核旧资料提升为正式证据。
- [x] 任务的检索真实接入图；只接受 CURATED_PUBLIC + APPROVED 且匹配受控元数据的资料，保留引用标识和来源。
- [x] 检索不足最多改写一次，仅改查询文本，不扩大访问范围、受控条件或启用外部网页搜索。
- [x] 普通私人问答保持独立授权；其他用户资料、被隔离或撤回资料不能成为正式诊断证据。
- [x] 任务页可追踪所用资料或证据不足；只补齐必要审核与元数据入口，不扩成完整运营平台。

## Verification

通过管理、任务和检索 API 用支持的文本/PDF 样例验证允许/拒绝集合；无需等待 Word 兼容任务 07。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。


## 实施与证据

实现与验证边界见 docs/controlled-reference-evidence.md。新增 V19 必须先升级再部署。受控 API/浏览器结果不代表真实基础设施、真实模型或临床验收通过。


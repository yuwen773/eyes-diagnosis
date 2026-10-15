# 21 — 使用有效模型完成最终诊断验收

**What to build:** 以已验证权重跑通真实图片诊断与所有核心人工分支，汇总 spec 的验收证据，明确哪些能力可以宣布完成。

**Blocked by:** 20 — 交付可复现部署、切流与回退演练。

**Status:** blocked-external（已登记用户指定权重并完成五图真实推理 smoke；真实 embedding/LLM、真实参与者与完整端到端验收尚未完成，工单 19/20 阻塞保留）

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-01、AC-02、AC-03、AC-04、AC-05、AC-06、AC-07、AC-08、AC-09、AC-10、AC-11、AC-12、AC-13、AC-14、AC-15、AC-16、AC-17、AC-18、AC-19、AC-20、AC-21、AC-22；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [ ] 具有有效模型权重与来源校验配置，真实图片经 PyTorch、质量门、证据、解释与必要复核到合法终态。
- [ ] 真实用户批准或拒绝保存、聊天与上传共享任务，以及重启/断流恢复均有可追踪演示结果。
- [x] 逐项汇总 AC-01 至 AC-22 的测试、真实服务与前端证据，不用先前测试数字、skip 或模拟结果替代真实模型验证。
- [x] 无法取得权重时将本票明确标记外部阻塞，其他已完成票可如实关闭，但不能宣称整个诊断迁移完成；不扩展为训练新模型。（本次已取得权重；其他外部条件仍阻塞，未宣称迁移完成或训练模型。）
- [x] 确认旧业务行为、原 Java 代码和回退能力保持约定，迁移变更与旧缺陷清单分别整理。

## Verification

真实模型与最终端到端验收；有效权重和来源校验配置是外部前置条件，训练不在本票范围。

2026-10-15 执行记录见 [`docs/model-final-acceptance.md`](../../../../docs/model-final-acceptance.md)。
收到用户提供的主工作树 `algorithm/models/efficientnet_b4_20250330_211341/` 后，实算两份
checkpoint 均为 74,648,175 字节，SHA256 均为
`64b433f5187f7a7d6ea08c20fb159695dc0731df7b2b22fd10aa7bb853662531`。
仅在迁移工作树登记该摘要，主工作树、校准状态、Java、根 pom 与源 spec 不变。

原 `InferenceEngine` 严格加载真实 state_dict，五张用户指定图片均生成真实推理包；
均进入质量 REVIEW 候选。`2_left.jpg` 与 `30_left.jpg` 的 top-1 是 normal，与用户给定
参考标签集合不符，原样记录。保留 NOT_CALIBRATED，不宣称概率已校准或临床准确率通过。
原训练摘要中的 0.6342123056118999 未在本票复算；无证据证明旧 checkpoint 使用了后来的
冻结划分或完成 5-fold OOF。模型材料与冻结产物分别保留摘要，不伪造训练血缘。

同五图另经原 HTTP 上传→Worker→生产图进入 WAITING_HUMAN_REVIEW，幂等重放、
跨用户 403、新 Worker 不消费人工等待与无预测泄露均通过，正式诊断记录为 0。
该层 SQLite/Java 身份为替身，无真实参与者或医生操作，不冒称完整真实服务闭环。

本票重新执行 Web 全量 727 passed、28 skipped；前端 47 passed，类型检查与构建通过。
真实模型运行与受控依赖回归分别记录于 `.scratch/python-agent-migration/evidence/issue21/`。
历史工单 20 的真实基础设施证据已核对 504 项源码/前端摘要，没有改称本票重跑。
完整真实模型 HTTP→MySQL→Worker→证据/解释→必要复核与真实用户保存决定仍未验收；
真实 embedding、旧 Java 大 Long 用户检索、真实 LLM/COS、临床与生产切流边界均保留。
因此前两项保持未勾选，本票不关闭，也不宣称整个迁移完成。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。


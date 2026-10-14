# Python Agent 迁移任务索引

日期：2026-10-12（Asia/Shanghai）  
状态：用户已确认拆分；21 张任务已发布为 ready-for-agent，尚未开始实施。  
已确认保存方式：本地 Markdown，仅在迁移 worktree 管理，不发布 GitHub Issues。

来源：[Python Agent 迁移与眼底诊断工作流 Spec](../superpowers/specs/2026-10-12-python-agent-migration-spec.md)。

每张任务是独立文件，含端到端交付、阻塞关系、验收项、验证方式和约束，已按技能约定保存到本功能的 issues 目录，状态为 ready-for-agent。源 spec 保留为唯一规范，不复制另一份可漂移正文。

## 拆分原则

- 以可演示的用户行为拆分，不按 ORM、API、UI、测试四层分别建票；需要页面时同票完成必要页面和边界测试。
- 先保存现有迁移基线；没有发现必须先做的额外预重构，不增加推测性重构票。
- 主工作流先以验证输入或明确不可用终态贯通，不能为演示伪造成功诊断；后续增量接入真实能力。
- 阻塞边仅表达真正前置条件，省略传递依赖；独立票可以并行推进，但执行时一次领取一张前沿任务。
- 07 不阻塞 08：受控证据先用已支持的文本/PDF，Word 兼容在整体验收前汇合。
- 13 不阻塞于 11：历史查询使用既有记录，不必先完成新的保存确认。
- 16 可在推理接入后验证调度可靠性，不必等待聊天和解释全部完成。
- 21 的有效权重是外部验收前置条件；模型训练不进入本轮票据。

## 任务与依赖

| 编号 | 任务 | Blocked by | 独立交付 |
|---|---|---|---|
| 01 | [建立可复现的现有 FastAPI 业务基线](../../.scratch/python-agent-migration/issues/01-fastapi-baseline.md) | 无 | 在迁移工作树启动现有业务服务，通过原前端完成登录后查询与既有业务操作，并形成可定位的兼容基线，作为后续 Agent 迁移的对照。 |
| 02 | [跑通上传任务的持久执行最小闭环](../../.scratch/python-agent-migration/issues/02-durable-upload-workflow.md) | 01 | 用户从上传页创建诊断任务，得到任务标识和可查询的进度；实际 Python Worker 执行 LangGraph，服务重启后仍可查看并继续原任务。 |
| 03 | [接入 PyTorch 推理并执行质量门](../../.scratch/python-agent-migration/issues/03-inference-quality.md) | 02 | 上传图片后复用现有可靠性推理管线，用户得到通过、拒绝、待质量复核或明确技术失败的状态，质量和影像判断使用同一推理结果包。 |
| 04 | [完成图像质量人工复核与继续执行](../../.scratch/python-agent-migration/issues/04-quality-review.md) | 03 | 医生在复核页面领取质量任务，选择允许继续或要求重传；用户看到相应结果，恢复执行复用原推理包。 |
| 05 | [迁移普通聊天与当前会话记忆](../../.scratch/python-agent-migration/issues/05-chat-session-memory.md) | 01 | 用户继续创建和管理聊天会话，收到流式回答，后续消息能使用本会话已有内容；其他用户和其他会话的事实不会自动混入。 |
| 06 | [让聊天和上传页面共享诊断任务](../../.scratch/python-agent-migration/issues/06-chat-workflow-binding.md) | 02、05 | 用户在聊天中发起或继续图片诊断，聊天与上传页显示同一个 Workflow 的标识、进度和结果，不各自产生一套诊断记录。 |
| 07 | [补齐 .doc 与表格型 .docx 的上传检索](../../.scratch/python-agent-migration/issues/07-document-format-compatibility.md) | 01 | 用户上传旧版 Word 或以表格为主的 Word 文档后，正文有效内容进入知识库并可检索；解析失败与空文档被明确区分。 |
| 08 | [完成审核参考资料到受控诊断检索的闭环](../../.scratch/python-agent-migration/issues/08-controlled-evidence.md) | 03 | 管理员为诊断参考资料设置受控属性和审核状态；诊断任务只使用符合范围的参考证据，不会把私人或隔离资料混入正式解释。 |
| 09 | [生成并发布经校验的患者解释](../../.scratch/python-agent-migration/issues/09-validated-explanation.md) | 08 | 符合自动发布条件的任务展示可追溯解释；证据或声明不合格时展示限制，草稿不会作为正式结果泄露。 |
| 10 | [完成最终临床复核与受限发布](../../.scratch/python-agent-migration/issues/10-final-clinical-review.md) | 04、09 | 医生在独立的最终临床复核任务中作出允许决策，用户随后看到正式解释或受限结果，复核不会重新生成已完成推理。 |
| 11 | [实现正式诊断保存前的用户确认](../../.scratch/python-agent-migration/issues/11-confirm-diagnosis-save.md) | 09 | 用户查看拟保存的诊断内容，批准后保存一次，拒绝则不建立正式记录；系统不会把内部工作流快照误当成用户已保存。 |
| 12 | [补齐用户补充信息的暂停与恢复](../../.scratch/python-agent-migration/issues/12-supplement-resume.md) | 06 | 聊天需要补充说明时真正暂停等待，用户回复后继续原会话和任务；不重复处理同一输入，也不把自由文本变成新的临床分诊规则。 |
| 13 | [让聊天按需查询带来源的历史诊断](../../.scratch/python-agent-migration/issues/13-history-retrieval.md) | 05 | 用户在当前会话询问自己的既往诊断时，Agent 通过授权查询返回有来源的历史记录，且不会把历史症状当成本次病例事实。 |
| 14 | [迁移 MCP 工具选择并统一图像推理来源](../../.scratch/python-agent-migration/issues/14-mcp-parity.md) | 03、05 | 用户在 Python 聊天中使用自己启用的 MCP 工具，图像分类工具复用可靠性推理事实，工具失败不会伪装成诊断成功。 |
| 15 | [将 Agent 业务写入统一接入用户确认](../../.scratch/python-agent-migration/issues/15-approved-tool-writes.md) | 11、14 | 用户通过聊天提出修改资料等受支持业务操作时，先查看具体变更并批准或拒绝，内部或 MCP 工具都不能绕过确认直接写入。 |
| 16 | [验证并补齐任务竞争与技术失败恢复](../../.scratch/python-agent-migration/issues/16-worker-concurrency.md) | 03 | 服务出现重复投递、Worker 竞争、租约到期或算法超时时，用户仍看到一致的任务状态，过期执行者不能覆盖有效结果。 |
| 17 | [验证所有人工等待流程跨重启恢复](../../.scratch/python-agent-migration/issues/17-human-wait-restart.md) | 10、11、12、16 | 用户确认、补充信息和医生复核等待期间重启服务，相关人员仍能继续原操作，且旧审批或恢复不会重复推理或保存。 |
| 18 | [统一聊天和诊断事件并恢复断连界面](../../.scratch/python-agent-migration/issues/18-stream-reconnect.md) | 10、12、15 | 用户在聊天与诊断页面看到一致的进度、补充信息、确认、复核与结束事件，断网或刷新后能从服务端恢复当前任务状态。 |
| 19 | [完成真实基础设施和旧接口兼容验收](../../.scratch/python-agent-migration/issues/19-real-services-ci.md) | 07、13、17、18 | 在真实 MySQL、Redis、Chroma 和 Java 会话服务上运行 Python 完整用户流程与兼容回归，形成可重复执行的集成验证入口。 |
| 20 | [交付可复现部署、切流与回退演练](../../.scratch/python-agent-migration/issues/20-deploy-cutover-rollback.md) | 19 | 维护者按交付说明启动所有服务，逐项切换业务与 Agent 路由，并能切回旧系统而不遗失任务或让两套 Worker 竞争执行。 |
| 21 | [使用有效模型完成最终诊断验收](../../.scratch/python-agent-migration/issues/21-model-final-acceptance.md) | 20 | 以已验证权重跑通真实图片诊断与所有核心人工分支，汇总 spec 的验收证据，明确哪些能力可以宣布完成。 |

## 初始执行前沿

01 可以立即开始。完成 01 后，02（上传工作流）、05（普通聊天）和 07（文档兼容）可以分别推进。编号是依赖顺序与查找顺序，不代表全部任务必须单线串行。

ready-for-agent 表示任务说明已具备执行条件，不表示依赖已完成；真正可领取的任务还须其 Blocked by 全部完成。

## 验收覆盖

| Spec 判据 | 主要任务 |
|---|---|
| AC-01 | 02、06；21 汇总最终证据 |
| AC-02 | 02、05、13、14、19；21 汇总最终证据 |
| AC-03 | 05、13；21 汇总最终证据 |
| AC-04 | 03；21 汇总最终证据 |
| AC-05 | 03、14；21 汇总最终证据 |
| AC-06 | 08；21 汇总最终证据 |
| AC-07 | 09、10；21 汇总最终证据 |
| AC-08 | 12；21 汇总最终证据 |
| AC-09 | 11、15；21 汇总最终证据 |
| AC-10 | 11、15；21 汇总最终证据 |
| AC-11 | 04、10；21 汇总最终证据 |
| AC-12 | 02、04、10、12、16、17；21 汇总最终证据 |
| AC-13 | 16；21 汇总最终证据 |
| AC-14 | 05、06、18；21 汇总最终证据 |
| AC-15 | 01、05、14、19；21 汇总最终证据 |
| AC-16 | 07；21 汇总最终证据 |
| AC-17 | 19；21 汇总最终证据 |
| AC-18 | 07、08、19；21 汇总最终证据 |
| AC-19 | 01、19、20；21 汇总最终证据 |
| AC-20 | 20；21 汇总最终证据 |
| AC-21 | 04、06、10、11、12、18、20；21 汇总最终证据 |
| AC-22 | 02、16、19；21 汇总最终证据 |

验收覆盖表仅证明拆分覆盖了 spec，不证明实现或测试已经通过。21 汇总所有判据；真实基础设施在 19 验证、切流回退在 20 演练、真实模型在 21 验证。

## 发布记录

用户已确认 21 张任务的粒度、依赖与本地 Markdown 保存方式，按原拆分于 2026-10-12 发布。一票一文件，原草稿正文已迁入 issues，避免维护两套任务状态。

任务均为 ready-for-agent，但依赖尚未完成。当前可执行前沿为 01；其后按 Blocked by 推进。21 另需有效模型权重与来源校验配置，缺失时保留为外部阻塞，不以模拟结果代替验收。

本次仅发布任务文档，尚未实现业务、提交代码、推送或部署；源 spec 未修改。


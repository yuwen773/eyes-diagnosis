# 工单 21 双轴审查

用户确认基线：`f7cd13de6f5d627c8c0cf1b8db072243d7f3ffbe`。
两个独立只读子代理审查本票暂存增量：`git diff --cached f7cd13d`；
提交后对应 `git diff f7cd13d...HEAD`。不纳入已有 CLAUDE.md、frontend/.omc
删除及另一组 Python 项目迁移草案。工单与原 spec 是验收来源，原 spec 未修改。

## Standards

0 项问题；代码异味 0 项需处理判断。

修改集中于权重摘要登记、复现依赖、验证脚本与验收证据；Java、根 pom 和源 spec
未变。真实权重推理、SQLite/身份替身、历史真实基础设施、真实参与者和临床验收
明确分层。保留 NOT_CALIBRATED，不把 softmax 得分称为患病概率，不虚构训练血缘
或独立测试准确率。用户保存授权与医生复核保持独立；脚本未执行真实审批或正式
诊断保存。人工等待没有被称为最终终态，工单维持 blocked-external。

## Spec

0 项新增可修复缺陷；3 类明确保留的验收缺口，最终验收仍 BLOCKED。

1. 工单要求“真实图片经 PyTorch、质量门、证据、解释与必要复核到合法终态”。五图
   真实推理及 HTTP→Worker→生产图 smoke 只到 WAITING_HUMAN_REVIEW；报告明确这是
   持久等待，没有冒充完成。
2. 工单要求“真实用户批准或拒绝保存、聊天与上传共享任务，以及重启/断流恢复”，
   AC-21 要求前端覆盖保存、补充、复核与刷新恢复。当前模型流程没有真实用户或医生
   操作，没有跨进程重启或完整前端闭环；历史受控证据和本票组件回归明确分列。
3. 原 spec 要求实际 MySQL、Redis、Chroma、Java 会话服务和已验证模型权重，以及
   真实 Chroma 与 embedding。本票工作流 smoke 使用 SQLite 与身份替身，真实
   embedding/LLM/COS 未验证；历史工单 20 证据没有被改称本票重跑。

权重登记、五图结果、两项参考标签不符、NOT_CALIBRATED、无独立性能评估、旧训练
与后续冻结划分无已证实血缘，记录一致。Windows CPU 锁文件和复现脚本直接服务
本票验收，没有范围扩张。不能关闭工单 21。

合计：Standards 0 项需修复，Spec 0 项新增可修复缺陷、3 类外部验收缺口。

## 本票验证

安全结构化结果见
[`regression.json`](../.scratch/python-agent-migration/evidence/issue21/regression.json)、
[`ac-matrix.json`](../.scratch/python-agent-migration/evidence/issue21/ac-matrix.json)、
[`preservation.json`](../.scratch/python-agent-migration/evidence/issue21/preservation.json)
及同目录摘要清单。完整验收台账见 [model-final-acceptance.md](model-final-acceptance.md)。

- Web 全量：727 passed、28 skipped，0 failure/error。skip 分为未指定真实 MySQL URL 1、
  Nginx 未启用 4、MySQL 承接 opt-in 18、承接/重启 opt-in 4、SKIP LOCKED 1；不计通过。
- 前端：12 文件、47 passed；Vue 类型检查与生产构建通过，保留原有 chunk-size 提示。
- 注册表更新后相关推理/配置回归：59 passed。
- Python 类型检查：4 个部署文件与 2 个证据脚本通过，含未标注函数体；不宣称全仓 mypy。
- Web 133 个依赖、模型 CPU 158 个依赖一致性通过。模型锁按 `--require-hashes`
  同步成功，再次 dry-run 无变更；不是 CUDA/Linux 或干净机器离线验收。
- 两个复现脚本先写未验证结果。用预置 PASS 文件和缺失权重分别调用，均退出 1，
  结果替换为 NOT_VERIFIED，避免失败后残留旧绿色报告。
- 真实模型五图推理通过；同五图经原 API/Worker/图进入质量复核等待。身份和存储
  替身明确，正式记录为 0，没有真实参与者批准、真实服务闭环或临床验收。

本票源码、原 Java/pom 与 spec 保全检查相对确认基线进行；不把主分支或其他历史
分支之间的既有差异称为本票变更。没有生产部署、切流或 Git push。

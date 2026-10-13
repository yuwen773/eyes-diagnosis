# 工单 03：推理接入与质量门

实现日期：2026-10-13（Asia/Shanghai）。工作树：`py-rewrite`，分支：
`worktree-py-rewrite`。实施基线：`42256e941e638a55b96c4f68662948a31af5f287`。
本报告仅覆盖工单 03 对 AC-04、AC-05 的相关部分。

## 生产调用链

上传 API 创建持久任务，现有生产 Worker 执行注册的 LangGraph：

`validateImage → inference → imageQuality → visionExposure → explanationUnavailable`

图决定条件路由，Worker 只负责租约、checkpoint 与结果提交。图片无法解码或
格式不支持时直接 `REJECTED / INVALID_IMAGE`，不调用算法。

推理节点调用现有 `InferenceEngine`，复用 PyTorch 模型加载、权重注册表、
校准、质量评估与拒绝策略。没有新增默认类别、未训练模型回退或伪造结果。
同时修正迁移适配中的返回值错误：拒绝策略返回 `AbstainDecision`，调用方
读取该对象并将原因枚举序列化为原有字符串；之前返回元组会在真实推理中失败。

每个 workflow/inference epoch 的结果保存为冻结的 `InferenceEnvelope`。
嵌套快照使用 JSON 字符串，避免共享可变列表。复用已有 V11
`t_inference_envelope`，无需新增迁移。结果绑定图片 SHA-256、媒体类型、epoch、
模型版本、权重指纹、预处理版本与推理策略版本；模型结果同时与部署配置校验。

推理包插入、工作流引用和 checkpoint 在同一租约/fencing/version 校验事务内
提交，数据库唯一键约束 `(workflowId, inferenceEpoch)`。写端只插入，不更新或
覆盖已提交包。后续质量、影像节点读取同一提交包，并检查图片和 epoch 绑定。
重复投递复用已提交包；失去租约的执行者丢弃未提交结果，不产生第二份业务结果。

## 用户可见行为

| 情形 | 状态与原因 | 行为 |
|---|---|---|
| 无效图片 | `REJECTED / INVALID_IMAGE` | 请求重新上传，不执行推理 |
| 质量强制拒绝 | `REJECTED / QUALITY_REJECTED` | `qualityGate=REJECT`，不进入影像节点 |
| 质量观察模式发现问题 | `WAITING_HUMAN_REVIEW / QUALITY_REVIEW_REQUIRED` | `qualityGate=REVIEW`，持久保存结果并停止自动调度 |
| 质量通过 | `qualityGate=PASS` | 进入影像暴露门，继续复用原推理包 |
| OOD 或策略拒绝 | `COMPLETED_LIMITED`，保留拒绝原因 | 不发布疾病预测，也不写正式记录 |
| 模型缺失或注册校验失败 | `FAILED / MODEL_UNAVAILABLE` | 明确不可用，不运行未验证模型 |
| 结果指纹不匹配 | `FAILED / MODEL_FINGERPRINT_MISMATCH` | 技术失败，不进入质量路由 |
| 无效类别或概率 | `FAILED / INVALID_RESPONSE_CONTRACT` | 技术失败，不制造有效预测 |
| 算法异常 | 重试后 `FAILED / INFERENCE_FAILED` | 沿用任务退避与尝试上限，不转成临床拒绝或待复核 |
| 有效预测但解释尚未接入 | `FAILED / EXPLANATION_NOT_AVAILABLE` | 明确后续能力未接入，不伪造已完成诊断 |

低置信度仍遵守原策略：`rejected=False, requires_review=True` 不擅自改成
安全拒绝。该事实保存在推理包中，留给后续风险/临床复核流程使用。质量问题
依据质量原因单独路由，不能将低置信度等同于图像质量问题。

查询 API 增加可空 `qualityGate`，并真实标示 `doctorReviewRequired`。
患者响应的 `result` 始终为空，`patientVisible=false`；内部预测和未发布解释
均不输出。前端显示质量与技术失败原因，刷新后读取服务端状态。
自由文本 question 仍可保存，但不进入推理、症状抽取或临床路由。
新工作流不写入 `t_diagnosis`；旧同步诊断端点保持既有契约。

## 验证

在迁移工作树的 `algorithm` 目录，使用已锁定环境：

```powershell
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_workflow_inference.py -q
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
& .venv-baseline/Scripts/python.exe -m mypy web/workflow web/routers/workflow.py web/schemas/workflow.py web/verify_workflow.py --follow-imports=silent --ignore-missing-imports --check-untyped-defs
uv pip check --python .venv-baseline/Scripts/python.exe
```

前端目录：`npm exec vitest run` 和 `npm run build`。

新增 20 项推理工作流测试经真实 FastAPI 路由、Java 鉴权 transport double、
SQLite 文件库、生产 Worker 和注册图验证：质量通过/拒绝/复核、来源四元组、
无效响应、真实引擎缺权重/未注册权重、算法异常重试、重复投递、租约失效、
重建 Worker 复用推理包、文本不改变路由、隐藏预测以及正式记录数不增加。

可靠性管线测试只将训练模型替换为可控 logits，真实调用注册表、校准、
图片质量评估和拒绝代码，验证 observe/enforce 和实际低置信度返回。
这是受控模型工程测试，不是 PyTorch 或真实权重推理验收。

真实 Chromium 使用 Vue 页面与模拟 HTTP 响应验证五种状态及刷新恢复，
没有页面脚本错误。证据：[检查结果](workflow/issue03-ui-results.json)、
[质量通过](workflow/issue03-quality-pass.png)、
[质量拒绝](workflow/issue03-quality-reject.png)、
[待复核](workflow/issue03-quality-review.png)、
[模型不可用](workflow/issue03-model-unavailable.png)、
[技术失败](workflow/issue03-technical-failure.png)。模拟接口没有真实模型或外部服务。

最终 Python Web 回归 448 项通过（新增推理测试 20 项）；前端 5 个文件的
19 项测试通过，mypy、前端类型检查与生产构建通过。
双轴审查见 [审查记录](workflow/issue03-review.md)。

## 后续边界

- 本地验证环境没有 PyTorch，未配置权重，注册表允许列表为空。真实模型成功
  推理未验证，保留至工单 21；未用模拟测试宣称解除阻塞。
- 本次没有执行真实 MySQL、Java、Redis、Chroma 联调或生产切流。SQLite
  测试不替代 MySQL 并发/事务验收，相关矩阵仍属于后续工单。
- 质量复核任务、医生页面、领取/提交与恢复由工单 04 实现。本票保留等待状态
  与原推理包，不宣称医生操作已可用。当前等待分支结束本图分段；工单 04
  需要设计版本化的继续执行入口，不能重新推理或静默恢复不兼容图。
- 图版本更新为 `upload-inference-v2`。旧 `upload-minimal-v1` 未完成任务继续
  明确拒绝不兼容恢复；不自动用新版执行旧 checkpoint。
- 证据、解释发布、最终临床复核、用户保存确认及聊天绑定按后续工单交付。
  质量通过不表示诊断完成，医生复核不表示用户批准保存。
- 原 Java 源码、构建配置、Flyway 历史和源 spec 均未修改。

定位交付提交：`git log -1 --format=%H -- docs/inference-quality-workflow.md`。

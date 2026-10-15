# 工单 21：真实模型与最终验收台账

日期：2026-10-15（Asia/Shanghai）。工作树 `py-rewrite`，比较基线
`f7cd13de6f5d627c8c0cf1b8db072243d7f3ffbe`。
本报告对应[工单 21](../.scratch/python-agent-migration/issues/21-model-final-acceptance.md)，
逐项对照[原 spec 的 AC-01～AC-22](superpowers/specs/2026-10-12-python-agent-migration-spec.md#testing-decisions)。
源 spec、原 Java 源码与构建配置不在本票修改范围。

**最终验收 BLOCKED。** 已取得用户指定的历史 checkpoint，实测摘要一致，并在本迁移
工作树注册其 SHA256。真实 embedding、解释/聊天 LLM、完整真实用户与医生操作及临床
验收没有因此通过。工单 19/20 的遗留阻塞继续保留。

## 模型材料与证据边界

安全结果目录：[issue21](../.scratch/python-agent-migration/evidence/issue21/)。
独立双轴审查及本票检查结果见 [model-final-acceptance-review.md](model-final-acceptance-review.md)。

- [preflight.json](../.scratch/python-agent-migration/evidence/issue21/preflight.json)：收到用户
  路径前的本机检查。进程未配置权重/SHA，原注册表为空，Web 环境缺 torch。只检查了
  两个 checkout 的 checkpoints/configs/datasets；**不是全盘无权重证明**，用户后续在
  `algorithm/models/` 提供的权重解除“找不到权重”的前提。环境变量存在性仅针对当前
  进程，不代表私有配置或其他服务没有凭据。
- [materials.json](../.scratch/python-agent-migration/evidence/issue21/materials.json)：重新
  计算两份权重、训练摘要、曲线与冻结划分产物摘要。两份权重均为 74,648,175 字节，
  SHA256 均为 `64b433f5187f7a7d6ea08c20fb159695dc0731df7b2b22fd10aa7bb853662531`。
  只使用 `best_acc_eye_disease_model.pth`，不作为两个模型的对照实验。
- `training_summary.json` 记录 EfficientNet-B4、25 epoch、`sample_ratio=0.5`、
  `use_full_data=false`、`test_accuracy=0.6342123056118999`。这是旧训练产物自述，
  本票未重新计算该准确率，也未完成独立测试集评估。
- 冻结划分与 `_SUPERSEDED.md` 单独保留摘要。不能据此证明 2025 checkpoint 使用了
  修复后的 2026 划分。注册表原有 `training_data_version=frozen_validation_manifest.json`
  是继承的标识，**不构成已核实的训练血缘**。训练、5-fold OOF 与修复旧划分不在本票执行。
- 保留 `NOT_CALIBRATED`、temperature=1.0；分类 softmax 得分不是患病概率。
  `calibratedProbability=0` 代表没有校准输出，不能解读为零风险。OOD 的
  `NOT_EVALUATED` 也不能宣称分布外检测已完成。
- 五张图片按用户给定参考标签记录：正常、白内障、D+O、病理性近视、G+O。
  参考来自用户提供的 `Traning_Dataset.xlsx` 描述，本票不把它当独立核对后的单标签金标准，
  不以这五张选定图片计算准确率，也不把训练目录图片称为未见过的测试集。

## 结果分层

真实模型五图结果（得分为未校准的 top-1 softmax 百分数，不是临床风险）：

| 图片 | 用户给定参考标签集合 | 实测 top-1 | 得分 | 质量候选 |
|---|---|---|---|---|
| `1_left.jpg` | normal | normal | 45.43 | REVIEW |
| `0_left.jpg` | cataract | cataract | 87.67 | REVIEW |
| `2_left.jpg` | diabetes + other | normal | 36.67 | REVIEW |
| `13_left.jpg` | myopia | myopia | 63.68 | REVIEW |
| `30_left.jpg` | glaucoma + other | normal | 38.69 | REVIEW |

真实输出见 [model-smoke.json](../.scratch/python-agent-migration/evidence/issue21/model-smoke.json)。
两项标签不符的事实保留；不计算五图“准确率”，不修改权重、阈值或校准来获得成功。
`VALID_PREDICTION` 是推理包中的技术状态，质量 REVIEW 与低置信门仍需图路由处理，
不等于患者可见预测、解释已发布或诊断已保存。

补充 [model-workflow.json](../.scratch/python-agent-migration/evidence/issue21/model-workflow.json)
通过原 HTTP 上传接口→原 Worker→生产注册图处理同五张真实图片，均停在
`WAITING_HUMAN_REVIEW`，患者 `result=null`、不可见预测、正式诊断记录为 0。
逐图检查同键上传返回原任务、另一用户读取 403、新 Worker 不消费人工等待、只读查询
保持原状态。这一层重用现有 HTTP 夹具，**SQLite 与 Java 身份为替身**；没有医生或用户
审批，没有跨进程重启、真实 MySQL 或后续证据/解释闭环。待复核是合法持久等待，
不是最终合法终态。复现时将 smoke 命令的脚本名改成 `run_model_workflow.py`，输出改成
`model-workflow.json`。

| 层级 | 本票证据与结论 |
|---|---|
| 权重完整性 | 两份权重摘要一致，迁移工作树 allow-list 登记一份摘要；主工作树不修改 |
| 真实模型 smoke | 原 `InferenceEngine` / `WorkflowInference` 五图执行 PASS；另经 HTTP/Worker/图进入质量复核等待，身份/存储替身单列 |
| 受控依赖回归 | 本票重新执行 Web 全量、前端全量、类型检查与构建；数字由 `regression.json` 记录，skip 保持独立 |
| 真实基础设施 | 引用工单 20 的 MySQL/Redis/Chroma/Java/API/Worker/Nginx 隔离实测；本票不重跑，也不改称本票新实测 |
| 真实 embedding | 工单 19 的供应商预检 HTTP 401；工单 20 使用受控向量。未在本票重试，仍 BLOCKED |
| 旧 Java 读端 | 大 Long 用户 ID 过滤 `NumberFormatException` 仍 BLOCKED；小 ID 通过不代替此项 |
| 真实 LLM / COS | 没有本票实际供应商流程证据，NOT_VERIFIED |
| 真实用户/医生与临床 | 工程账号、自动审批、受控浏览器均不能替代真实参与者；NOT_VERIFIED |
| 生产切流/热切换/旧执行器交接 | 只有历史隔离演练；生产发布未执行，NOT_VERIFIED |

历史实测锚点 E20：
[results.json](../.scratch/python-agent-migration/evidence/issue20/local/results.json)，
[源码与前端摘要](../.scratch/python-agent-migration/evidence/issue20/local/source-sha256.json)，
[部署审查](deploy-cutover-review.md)。执行时间为 2026-10-15 07:53 UTC。
本票预检逐一核对 E20 的 504 个文件摘要，全部匹配；这是源码关联核查，不是服务重跑。
E19 的旧摘要有三个文件已变化，保留历史来源及差异，不冒称当前版本全量匹配。

## AC-01～AC-22 证据索引

T 表示本票重新运行的 `algorithm/web/tests/` 中对应文件；Web JUnit 逐条记录 pass/skip。
E20 表示上述历史真实基础设施结果，分类/解释/聊天/COS 与向量仍有受控适配器。
UI 文档是历史浏览器结果与复现入口；本票前端组件测试和构建不替代浏览器端到端。
下表整理工程覆盖和最终缺口，**不作 22 项均已完成的声明**。

| AC | T：受控回归文件 | 真实服务与前端已有证据 | 最终验收缺口 |
|---|---|---|---|
| 01 | `test_workflow.py`, `test_chat_workflow.py` | E20 上传/图；[聊天绑定 UI](chat-workflow-binding.md) | 真实模型经聊天与上传共享原任务、幂等与只读查询演示 |
| 02 | `test_chat.py`, `test_quality_review.py`, `test_save_confirmation.py`, `test_mcp_chat.py`, `test_history_retrieval.py` | E20 Java 身份、用户权限、审批冲突 | 真实模型流程的跨用户/越权复验 |
| 03 | `test_chat.py`, `test_history_retrieval.py` | E20 历史工具；[会话 UI](chat-session-memory.md) | 真实 LLM 两轮与跨会话事实隔离；历史查询 UI 未验 |
| 04 | `test_workflow_inference.py`, `test_quality_review.py` | E20 质量复核；[质量 UI](quality-review-workflow.md)；真实模型五图进入原图质量复核等待 | PASS/REJECT 两类真实样本路径及共享推理包的完整真实服务流程 |
| 05 | `test_inference.py`, `test_workflow_inference.py`, `test_worker_explanation_failure.py`, `test_mcp_image.py` | E20 缺模型旧同步失败保护；模型 SHA 实测 | 工程失败保护有覆盖；不由此推导真实诊断成功 |
| 06 | `test_controlled_evidence.py` | E20 元数据/范围/撤回；[受控资料](controlled-reference-evidence.md) | 真实 embedding 的受控范围召回与一次改写 |
| 07 | `test_validated_explanation.py`, `test_final_clinical_review.py` | E20 来源撤回/受控解释；[解释 UI](validated-explanation-workflow.md) | 真实 LLM 来源/声明门及真实模型合法发布终态 |
| 08 | `test_supplement.py`, `test_human_wait_restart.py` | E20 补充等待；[补充 UI](chat-supplement-resume.md) | 真实用户补充、相同交互与任务恢复演示 |
| 09 | `test_save_confirmation.py`, `test_tool_writes.py` | E20 本人批准一次保存；[保存 UI](diagnosis-save-confirmation.md) | 真实模型结果的真实用户拒绝/批准保存 |
| 10 | `test_save_confirmation.py`, `test_tool_writes.py`, `test_human_wait_restart.py` | E20 版本冲突/重放；保存 UI | 真实模型完整流程的内容变化、重启后授权重放 |
| 11 | `test_quality_review.py`, `test_final_clinical_review.py` | E20 真实 Java 医生角色；[最终复核 UI](final-clinical-review-workflow.md) | 真实模型触发两类复核矩阵、真实医生参与 |
| 12 | `test_workflow.py`, `test_human_wait_restart.py` | E20 真实 MySQL 重启与四类等待保全 | 真实模型在执行中/人工等待时重启的完整演示 |
| 13 | `test_worker_concurrency.py` | E20 MySQL 竞争、租约、fencing、版本与重试 | 历史基础设施工程证据具备；本票 skip 不算新实测 |
| 14 | `test_stream_reconnect.py`, `test_chat.py` | E20 TCP SSE；[断网重连 UI](stream-reconnect.md) | 真实模型/LLM 下的断流、刷新恢复 |
| 15 | `test_contracts.py`, `test_user.py`, `test_news.py`, `test_knowledge.py`, `test_diagnosis.py`, `test_chat.py`, `test_mcp_server.py` | E20 Java/Python Long/日期/分页/注销对照 | 旧同步诊断真实模型成功路径、完整真实依赖契约 |
| 16 | `test_document_upload.py`, `test_knowledge.py` | E20 二进制 DOC、表格 DOCX 上传；[格式 UI](document-formats.md) | 真实 embedding 检索与有效语义内容 |
| 17 | `test_worker_concurrency.py`, `test_human_wait_restart.py` | E20 真实 MySQL 事务/行数/租约/冲突 | 历史工程实测有据；本票未重新运行 MySQL 专属套件 |
| 18 | `test_controlled_evidence.py`, `test_document_upload.py` | E20 真实 Chroma、受控向量、引用与范围 | 真实 embedding；旧 Java 大 ID 读端仍阻塞 |
| 19 | `test_baseline.py`, `test_nginx_routing.py`, `test_cutover_proxy.py` | E20 原 Java/Redis 会话、Flyway V22、Nginx 与浏览器 | 历史隔离实测有据；未变更 Java 会话归属或放行生产 |
| 20 | `test_cutover_proxy.py`, `test_real_services_runner.py` | E20 独立切流/暂停/排空/等待快照；[部署手册](deploy-cutover-rollback.md) | 完整真实模型运行环境、真实旧执行器交接与生产热切流 |
| 21 | `test_stream_reconnect.py`, `test_save_confirmation.py`, `test_supplement.py`, `test_final_clinical_review.py`；Vue 组件全量 | E20 无网络 mock 的 Chromium 登录/上传/刷新/聊天；其余 UI 文档明确受控 | 一套完整真实模型、真实参与者的核心分支前端端到端 |
| 22 | `test_foundation.py`, `test_workflow.py`, `test_worker_concurrency.py` | E20 生产注册图、独立 Worker、checkpoint 与合法终态 | 真实权重经生产 HTTP→MySQL→Worker→证据/解释/必要复核到终态 |

## 恢复验收所需材料与步骤

1. 权重通过摘要注册后仍须严格加载原 state_dict。模型 CPU 环境的实际版本与依赖记录
   随本票保存；Web 锁文件本身不包含分类依赖，不能单独作为模型发布环境。
2. 保留现有校准状态与质量策略，不为了演示改成 CALIBRATED、改变阈值或伪造复核分支。
   需要特定分支时挑选有来源的适当图片；受控分支回归单独计数。
3. 提供有效 embedding/LLM/COS 的外置配置，按工单 19 入口重新验证。其入口仍使用
   确定性分类器，**不能作为真实分类验收入口**。原 Java 大 ID 问题另立旧缺陷处理，
   不能通过换小 ID 或本票修改 Java 掩盖。
4. 在隔离真实 MySQL/Redis/Chroma/Java/API/Worker/Nginx 中，由实际用户和医生操作
   原前端：上传与聊天绑定同任务、拒绝与批准保存、补充、两类复核、执行中与等待时
   重启、SSE 断流恢复。记录 workflowId/sessionId/runId、确认与复核版本、推理包摘要、
   模型调用数、正式记录 ID 和终态。医生批准不能代替用户保存授权。
5. 将每项真实服务、真实模型、前端、临床结果分别补入本台账；只有所需判据均通过
   才能关闭最终验收。测试账号自动确认不冒称真实用户授权；不发布生产、不训练新模型。

推理 smoke 复现（先进入 PowerShell 7，工作目录 `algorithm`）：

```powershell
uv venv .venv-model-acceptance --python 3.11
uv pip sync --python .venv-model-acceptance/Scripts/python.exe requirements-model-cpu.lock --torch-backend cpu --require-hashes
uv pip check --python .venv-model-acceptance/Scripts/python.exe
& .venv-model-acceptance/Scripts/python.exe ../.scratch/python-agent-migration/evidence/issue21/run_model_smoke.py `
  --weights 'D:/Work/code/eye-diagnosis/algorithm/models/efficientnet_b4_20250330_211341/best_acc_eye_disease_model.pth' `
  --images 'D:/Work/code/eye-diagnosis/algorithm/datasets/DataSet/Training_Dataset/Training_Dataset/Training_Dataset' `
  --output ../.scratch/python-agent-migration/evidence/issue21/model-smoke.json
```

CPU 依赖来源按 [PyTorch 官方安装说明](https://pytorch.org/get-started/previous-versions/)，
完整 Windows x64 / Python 3.11 锁文件为
[`requirements-model-cpu.lock`](../algorithm/requirements-model-cpu.lock)，固定版本及发行包 SHA256。
仅在对应平台验证，不推广为 CUDA 或 Linux 发布证据。实际安装清单见
[`model-runtime.freeze.txt`](../.scratch/python-agent-migration/evidence/issue21/model-runtime.freeze.txt)。
原模型构造器在覆盖 checkpoint 前仍请求 torchvision 的 ImageNet 预训练权重；本机缓存已存在。
离线机器还需准备该缓存；本票没有宣称干净机器离线启动通过。

## 旧行为、迁移与回退

本票只登记明确摘要、整理安全证据与验收台账；未修改 Java、根 pom、源 spec、临床图、
正式写入规则或数据库迁移。`MODEL_WEIGHTS_PATH/SHA256` 继续由部署显式注入；没有
把个人绝对路径写入生产默认配置。Java 仍拥有 login/get-login/logout 三个会话端点。

迁移行为与旧缺陷分别见 [migration-decisions.md](migration-decisions.md) 和
[rewrite-findings.md](rewrite-findings.md)。工单 19 的旧 Java Long 检索问题单独保留；
原训练/冻结数据事故有来源记录，不能用它推导本 checkpoint 的临床性能。
回退继续沿用工单 20 的暂停/排空、Python 查询保留与单执行器归属；登记权重不执行
切流、不恢复暂停任务、不改变任何用户批准或医生复核状态。

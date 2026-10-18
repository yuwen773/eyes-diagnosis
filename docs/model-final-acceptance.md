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

## 2026-10-17：Windows 纯 Python 最终验收执行记录

本节是新增实测，前文保留为 2026-10-15 历史结论。当前技术边界由
[ADR 0001](adr/0001-complete-python-migration.md) 和
[本轮计划](plans/2026-10-17-python-final-acceptance-plan.md) 确定；Python 自有
`EYE_SESSION`/Redis 身份替代旧 Java 身份，不恢复 JVM、旧 Java 读端或旧部署要求。

**当前仍为 BLOCKED，第 21 票不关闭。** 本轮 runId 为 `20261017T-windows-01`，
证据入口：[本轮索引](../.scratch/python-final-acceptance/20261017T-windows-01/README.md)。
运行环境为现有 Python 3.11.17；项目声明 3.11.14 单列，不宣称干净机器验收。
主检出 `.env` 仅本机显式读取，未复制供应商凭据；调用计数由 API/Worker 共用的本机透明
转发器持久登记，失败亦消耗额度，当前为 LLM **6/50**、embedding **31/500** 个输入文本。

### 实现修复与回归

- 图片及知识库上传在公开 HTTP 接口复现 `qcloud_cos.COSClient` 不存在。保留真实 SDK，
  仅替换受控网络传输；将三处上传/删除调用最小修复为 `CosS3Client`。成功、拒绝和删除
  回归与持久额度/透明转发回归共 7 项通过，真实图片及文档 COS 接口随后验证通过。
- 真实结构化解释预检返回 HTTP 400，供应商明确要求 JSON 模式消息包含 `json` 字样。
  公开工作流回归先复现“受限完成”，提示词只新增 `JSON`；相关受控回归 31 项通过。
  修复后真实预检遇到生产客户端 `ReadTimeout`，保留 BLOCKED，不追加无限重试。
- 最终 Windows Web 全量为 **821 passed、1 failed、43 skipped**。失败为
  `test_doctor_wait_claim_and_submitted_decision_survive_process_restart[quality]` 的重复提交
  响应为空，随后 JSON 解码失败。原失败数据库、日志和 JUnit 已保留；同项单独复验
  **1 passed**。单项复验不抹去全量失败，根因尚未确认。
- 前端 **49 项测试**、类型检查与构建通过；独立隔离真实 MySQL 并发/租约回归
  **14 passed**，模型、身份和异常适配器为受控层，不混称真实参与者验收。

### 真实服务与模型

使用原 `scripts/run_service.py api|worker`，分别启动 API 和 Worker，采用新建隔离 MySQL
库 `eye_final_6d0e65d48d844123b59559297b83b797` 及独立 Redis/Chroma 数据目录。
Python 登录、大 ID、登出后旧 Cookie 失效均通过。真实 embedding 为 1024 维；真实流式
聊天收到内容与 `[DONE]`。真实 COS 合成图片上传、原接口返回 URL 无签名读取通过。

用户提供的 `src/main/resources/rag` 八份 Markdown、真实 DOC 与表格 DOCX，共十份资料
通过真实 COS/embedding/Chroma 索引；DOC/DOCX 各自检索回特征正文，大 ID 本人范围与
跨用户隔离通过。格式夹具只证明解析/检索，不作为医学证据。资料保持
`PRIVATE_USER/PENDING`，没有脚本代审为 `CURATED_PUBLIC/APPROVED`。

原五图均经原 HTTP、真实分类器、生产注册图和独立 Worker 进入持久质量复核。
同键重放、聊天绑定、跨用户 403、SSE 读回和等待状态的 API/Worker 重启已取证。
五份推理包保留摘要及来源；`2_left.jpg`、`30_left.jpg` 的 top-1 与参考标签集合不符
仍原样保留。权重 SHA256 复算与登记值一致，保持 `NOT_CALIBRATED`，不将分数称为患病概率。
另固定选择 `0_right.jpg`、`1_right.jpg`、`2_right.jpg` 做本机配对补充推理，保留全部原结果；
这是相关训练样本，不是独立测试集，未外发图片，去标识确认仍待完成。

### 人工与当前阻塞

用户确认患者与医生账号均已登录；已读到 `0_left.jpg`、`1_left.jpg` 两份真实医生质量复核提交，
原任务均进入 `COMPLETED_LIMITED / EVIDENCE_INSUFFICIENT`，正式记录为 0。
用户提供医生提交与患者结果截图，并明确确认 F5 后重新打开 `原图 1_left.jpg` 仍为同一任务；
该轮质量复核、刷新恢复及未隐式保存通过，证据见本轮
`20261017T113208Z-human-round2/verification.json`，原截图字节及 SHA256 已保留。
补充、最终复核及两个独立任务的拒绝/批准保存，尚无完整证据。
医生复核不能替代保存授权；脚本没有代点这些决定。

本轮还未通过：真实结构化解释超时、参考资料实际审核、完整人工 UI/保存闭环、
最终 Windows 全量失败的根因确认及样本外发前的去标识确认。
第一轮人工服务窗口已按进程身份清理；同 runId 的后续人工窗口继续取证中，
最终停止结果以各 attempt 的 `processes.json` 和 `real-services.json` 为准。
注册失败的早期 Redis 子进程已单独核对 PID/路径/创建时间后清理，原失败和恢复记录均保留。

AC-01～AC-22 的原要求、当前边界、证据层、结果和限制见本轮摘要。旧第 19/20 票只按
新的 Python 技术边界重新映射，旧 Java 失败不改写为通过。Linux、Docker/WSL、临床效果、
生产升级/切流、合并和推送均未执行，也不属于本轮通过声明。

### 19:39 人工审核确认与保存场景准备

用户明确确认三份参考资料均已审核通过。原 API 读回仍为待审核，因此依据该人工结论，
通过隔离管理员原 API 将 ID 2（normal）、4（cataract）、8（myopia）登记为
`CURATED_PUBLIC/APPROVED`、主题 `DISEASE_OVERVIEW`、治理版本 1；重新读回三份状态均符合。
这属于参与者确认后的治理登记，不作为人工管理员 UI 操作证据。原始确认、版本及响应见
本轮 `20261017T113839Z-save-preparation-e32923/`，
最终读回与待复核任务见 `20261017T113914Z-save-preparation-66ec26/`。

保存场景 A 使用新增独立 `0_left.jpg` 任务 `ddd7005b6b53453998bb34c3364d255f`，
场景 B 使用未处理的原 `13_left.jpg` 任务 `8e89a7a43d27410a9ece5887b51d8133`。
两项均经原 HTTP/独立 Worker 到达质量等待，聊天分别命名为“保存验收 A（拒绝）0_left.jpg”
与“保存验收 B（批准）13_left.jpg”。尚未代提交医生决定或患者保存决定；真实解释与最终保存
仍待运行验证，不能提前记为通过。旧受限终态没有改库重跑。

治理登记期间，ID 8 的 PATCH 已返回成功，但紧接列表读回仍显示版本 0；下一次独立查询
已读回版本 1。保留两次原响应，暂不能宣称“成功响应后立即可见”已通过；没有重复执行审批。

### 19:50 后续人工验收未执行

用户表示不继续人工实操。本轮不再请求患者或医生提交后续决定；既有两份质量复核及
刷新恢复证据保留。自动只读核验确认 A/B 两项仍为质量等待、共两份已提交质量复核、
正式记录为 0，见 `20261017T115046-observation.json`。后续人工复核与批准/拒绝保存登记
为未执行，不能替换成脚本代批或通过结论；参与意向见本轮 `manual-participation.json`。
本轮人工服务窗口已结束，7 个登记进程均核验停止；停止前后 8 张业务表摘要一致，
正式记录仍为 0，未新增供应商调用。结果见本轮 `manual-window-closeout.json`。
数据库、向量、COS 对象及原等待保留；验收总体仍 BLOCKED，不再要求本轮人工操作。

### 20:11 非人工修复增量（人工搁置）

用户要求继续处理结构化解释超时和全量失败，人工验收先搁置。修复记录见本轮
`noninteractive-repairs/diagnosis.md`，人工参与状态以新的
`manual-participation-deferred.json` 为准，先前不参与记录保留。

- 真实供应商原请求 50.375 秒返回，包含 1811 个 reasoning token；仅为诊断延长读取预算，
  不作为原适配器通过证据。解释请求现显式关闭思考模式、限制单条短引用及输出 token，
  禁用隐式环境代理；没有扩大原 10 秒读取超时、15 秒期限或 30 秒 Worker 租约。
  HTTP→Worker 回归先 RED 后 GREEN，相关 31 项通过；真实结构化解释预检通过。
- 对三份已审核资料使用原检索器、真实 MySQL/Chroma/embedding/ExplanationModel 取证。
  一次提示词修复后的复验：正常资料 2.953 秒、白内障 2.203 秒，均原文引用且 VALIDATED；
  近视资料 2.828 秒，仍因数值声明被 REJECTED。保留阻塞且不放宽校验、不反复调用。
  这不是完整生产图、解释发布或人工决定证据；8 张业务表摘要保持一致。
- 原全量空 JSON 失败项存在继承系统代理的环境依赖；可控代理在同一提交重放位置复现
  相同 JSONDecodeError。固定本机客户端直连后，新代理回归及原质量/最终复核重启
  共 3 项通过。历史缺响应头，保留该证据限制；未删除或放宽原断言。
- 前端重新构建、类型检查及 49 项测试通过。Windows 全量正在原验证入口运行，
  输出到 `windows-web-repaired/`，原 `windows-web-final/` 的失败不覆盖。

调用累计 LLM 14/50、embedding 37/500；临时检索进程已按登记身份停止，未自动提交
任何医生决定或保存授权。三份资料审核登记保持；近视解释扣留和人工项目仍单列。

20:22 完整验证结束：原 `scripts/verify.py web` 退出码 0，Windows Web **824 passed、
43 skipped、1 条既有警告、0 failed**（768.63 秒）；依赖、冻结迁移基线、退休扫描及
入口类型检查通过，修改文件另行类型检查通过。证据为本轮 `windows-web-repaired/web.xml`
及 `noninteractive-repairs/windows-web-repaired.log`。原 821/1/43 失败保留为历史，
不覆盖或改写。两项指定缺陷的修复验证完成；真实解释的近视数值扣留、人工搁置和补充
样本去标识边界仍保留，整体验收继续 BLOCKED，第 21 票不关闭。

### 20:40 近视原文片段修复（人工继续搁置）

用户要求保持安全规则不变，继续处理近视资料扣留。新增仅用于模型输入的片段选择，
按原文段落/列表/句子边界筛选，复用原 `validate_claims`，保留原引用 ID、全文、摘要及
审核版本；明确要求模型整段逐字复制。没有删除数字改写句子、拼接原文或绕过最终校验。
`validate_claims` 函数源码修改前后 SHA256 均为
`a30b21d65cab1003c5827950e007a9f6da51bffd679a564564e1b0b9724ec6c7`，规则版本未变。

公开 HTTP→Worker 回归先 RED 后 GREEN，最终相关 **34 项通过**，包含近视合法原文引用、
强行返回数值仍拒绝、删数字改写仍拒绝。首次真实复验由数值拒绝转为原文改写拒绝；
补充逐字复制要求后，对新失败复验一次，三份资料均 VALIDATED：正常 2.266 秒、白内障
1.656 秒、近视 **1.641 秒**。近视内容 23 字，引用 ID 与原文连续片段一致。
真实证据：本轮 `20261017T123739Z-reference-explanations-a68a9d/`；完整诊断及红绿证据：
`myopia-excerpt-repair/diagnosis.md`，先前失败均保留。

本层使用真实 MySQL/Chroma/embedding/ExplanationModel 和原真实推理包只读绑定，
8 张业务表摘要不变，临时 Chroma 已按登记身份清理；不是完整图恢复、发布或人工决定。
累计 LLM **20/50**、embedding **43/500**。前端新构建/类型检查及 **49 项测试通过**；
新 Windows 全量另存 `windows-web-myopia/`，运行完成后登记最终结果。
人工仍搁置，没有提交医生决定或患者保存授权，正式记录仍为 0。

20:52 新全量完成：`scripts/verify.py web` 退出码 0，**827 passed、43 skipped、0 failed**，
1 条既有警告，756.74 秒。前端构建/类型检查及 49 项通过；修改文件类型检查通过。
近视自动解释阻塞已解除，最新证据为 `windows-web-myopia/web.xml` 及
`myopia-excerpt-repair/`，历史失败与 824/43 等既有结果仍分别保留。
整体验收继续因人工搁置及补充样本去标识边界保持 BLOCKED，第 21 票不关闭。

### 23:03 审批响应即时可见性修复

按用户要求继续自动排查第 247 行记录的旧版本读取，人工验收仍搁置。
公开 PATCH 成功正文发送后、依赖清理前发起独立列表查询，连续两次稳定复现
版本 0/PENDING，原失败见本轮 `governance-visibility-repair/red*.xml`。
原路由仅 flush，而默认请求依赖在响应发送后才 commit，存在未提交读取窗口。
最小修复为审批返回成功前显式 commit；没有改全局依赖、版本锁、权限、确认或安全规则。
提交失败返回 HTTP 500/code 50000，状态回滚且可重试；旧版本重复提交仍返回 409。

定向回归为 **21 passed、1 skipped**。另以新建隔离 MySQL、独立 Redis 和原生产 API
入口连续审批 20 份合成资料，独立 HTTP 连接立即读回均通过，无等待、重试或轮询；
强制停止并重启登记的 API 后，20 份审批仍保留。这里没有替实际参考资料审批，
不是医生或患者人工验收。原参与者 8 张业务表前后摘要一致，最新只读快照仍是
2 条既有医生提交、0 条正式记录；两个 API 进程和独立 Redis 已清理。

新全量 `scripts/verify.py web` 退出码 0，**829 passed、43 skipped、0 failed**，
1 条既有警告，786.73 秒；依赖检查、22 项冻结迁移基线、退休扫描、入口及修改文件
类型检查通过。全量另存 `windows-web-governance/web.xml`，旧结果不覆盖。
前端未修改，沿用上一轮 49 项与构建/类型检查通过的证据，不记作本轮重跑。
本次外部供应商请求为 0，累计仍 LLM 20/50、embedding 43/500。

详见本轮 `governance-visibility-repair/diagnosis.md` 与 `real-mysql-result.json`。
摘要新增独立的治理响应可见性证据与门禁，不能再把“最终版本正确”替代即时读取验证。
该技术观察已闭环；人工与补充样本去标识/外发边界仍保留，整体继续 BLOCKED，
第 21 票不关闭；未执行 Linux、生产发布、合并或推送。

### 2026-10-18 Windows 原 43 项跳过测试补跑

按原 `windows-web-governance/web.xml` 的 43 个跳过 node ID 逐项重跑，最终为
**43 passed、0 failed、0 remaining skipped**；其中原生 Windows Nginx 7 项、真实隔离
MySQL/Redis 36 项。不是新的单次全量运行，保留此前 829 passed/43 skipped 的原始 XML，
不将分批证据改写为一次 872 项全量通过。

首轮 Nginx 为 5 passed/2 failed，失败断言仍要求登录去 Java，而 ADR 0001 与当前
渲染器已规定登录态接口跟随业务路由。仅修正测试预期，并加强登录、登录态查询、
退出三个接口的后端去向断言，Cookie/Host 转发检查保留；应用代码未改，复验 7 项通过。
首轮 MySQL 为 25 passed/11 setup errors；共用冻结版本解压路径达到 263 字符。
改用工作树内短临时目录，最长解压路径 190 字符，冻结 ZIP SHA256 完全一致，
没有改冻结 SQL、历史、业务断言或系统设置；11 项原测试复验全部通过。

覆盖资料撤销双连接、SKIP LOCKED、空库/V9/V22 承接、异常与中断升级、四类等待恢复、
真实 Cookie/Redis 登录恢复、过期保存、版本不兼容保留、陈旧和被终止执行器的租约隔离，
以及 Nginx 路由与维护写入门禁。模型、资料、后端标签及医生/保存决定均为合成夹具；
浏览器可选检查未运行，不计为实际参与者的人工验收。

逐项及历史失败证据见本轮 `skipped-tests-windows-20261018/README.md`、
`replay-summary.json`、两组首轮 XML 及 `nginx-recheck/`、`recovery-recheck/`。
原参与者 8 张业务表摘要不变，2 条既有医生提交、0 条正式记录；临时进程清理通过，
测试库与短目录保留用于审计。无新增供应商请求，累计仍 LLM 20/50、embedding 43/500。
摘要新增独立补跑层；普通未启用真实服务的全量仍可以按原门禁跳过，不移除 opt-in 保护。
人工验收继续搁置，样本去标识/外发范围仍未确认，整体 BLOCKED，第 21 票不关闭；
没有执行 JVM、Linux、Docker/WSL、生产升级/切流、合并或推送。

### 2026-10-18 验收计划逐条复核与剩余自动项

再次对照已确认计划的 2.1～5 与 AC-01～AC-22，逐项绑定当前实现与证据；
新增证据在本轮 `plan-audit-20261018/`，不覆盖旧 attempt 或旧失败。当前在既有材料、
预算与授权下，没有发现仍可独立执行的遗漏自动项；完整真实人工链路仍未通过。

本次完成此前没有执行或只验证部分边界的检查：

- 四类合成等待启用真实 MySQL/Redis + 原 Vue 无头浏览器刷新，**4 passed**。
  质量、最终复核、保存、补充四类截图及恢复核验均保存；合成决定不计真人实操。
- 已登记 COS 白色探针通过浏览器 img 加载、32×24 尺寸与摘要核对。顶层导航因原
  attachment 响应转为下载，原观察保留；没有改权限、响应头或新建 COS 对象。
- 原 API + 真实 Redis/MySQL + 真实 LLM 执行 3 次非医疗聊天，API 重启后记号仍在本会话，
  另一会话不读入；历史分别为 4/2 条消息，无诊断任务绑定。两个新会话仅是验收夹具。
- 新隔离库的原图 `1_left.jpg` 经原 API/Worker/生产注册图及真实本机 PyTorch，观察到
  实际 RUNNING 后强制停止 Worker/API；API 重启读回同一中间状态，Worker 恢复到质量等待。
  同键同任务、SSE 断连重连、单份已提交推理包和无正式记录均通过。未提交分段允许原机制
  重算，不承诺物理模型调用只有一次，没有外发该图片。
- 原实际患者与医生页面只读刷新通过，拦截非查询浏览器写入，未领取或提交复核、未保存。
  初次探针字段/终态名、隐藏 option/内部任务 ID 定位失败及正确复验均保留，只修正探针，
  没有改应用实现；后续 UI 复验没有重发模型调用。患者/医生截图已查看。
- 重新完成前端类型检查、构建和 **49 项测试**；摘要生成器类型检查通过。应用实现及
  安全规则未改，不重复未受影响的已通过全量；829/43 全量与 43/43 补跑继续分别记录。

22 个 AC 均有自动证据记录；按本轮 Windows/Python 边界，18 项技术判据有分层通过
证据，**AC-08/09/11/21** 保留实际参与者的补充、拒绝/批准保存、两类医生复核及完整
UI 操作阻塞。Java 要求仍按 ADR 0001 映射，不将旧 Java 失败改写为通过，不称临床效果
已验证。自动子项通过不代替真人实操，完整真实解释发布/保存仍依赖其继续。

累计 **LLM 23/50、embedding 43/500**；本次 LLM 3 次，共用原透明计数器。
原实际任务 8 张业务表摘要一致，原 2 条医生决定、0 条正式记录不变。
临时服务/进程已清理，隔离数据、截图、推理包、合成等待样本及调用证据保留。
详见 `plan-audit-20261018/README.md` 与 `completion.json`。

当前剩余：实际参与者操作及其后续真实发布/保存闭环；补充样本去标识及外发范围确认。
人工按用户要求继续搁置，不代批、不重排旧终态任务，不请求恢复实操。
第 21 票不关闭，整体验收仍 BLOCKED；Linux、临床效果、训练校准、托管 CI 和生产发布不在本轮范围。

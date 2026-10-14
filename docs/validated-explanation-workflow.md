# 工单 09：经校验的患者解释

2026-10-13，实施位置为 `worktree-py-rewrite`。沿用 release ADR-003/004/009：参考资料只支持一般信息，
不能证明患者级概率；质量复核、最终临床复核和用户保存授权彼此独立；自由文本不决定临床路由。
Java 源码、根构建配置与源 spec 未修改。本票不部署、不写正式诊断记录。

## 实际执行链

质量和可靠性门通过后，由 LangGraph 决定：

`clinicalRiskPrecheck → evidenceRetrieval → [evidenceRewrite] → evidenceValidation → clinicalRiskFinal`

具备证据时继续 `explanationDraft → explanationClaimValidation → explanationPublication`。
每个节点仍由现有 Worker 分段执行，在租约、工作流版本检查通过后，同事务提交 checkpoint、快照、任务和事件。
图版本与动作版本更新为 `upload-validated-explanation-v5`；旧版本 checkpoint 不能静默恢复。

风险判断沿用 release 的确定性发布策略，并读取绑定推理包中的 `requiresReview`。
它不解释 question，不从自由文本提取症状，也不调用模型作发布决策。

| 职责 | 能力边界 |
| --- | --- |
| 风险初筛、最终判断 | 只读绑定推理与来源状态，输出固定策略结果 |
| 证据检索 | 工单 08 的已审核公共资料范围；最多一次受控改写 |
| 解释生成 | 一次有界 OpenAI-compatible 请求，仅接收最多五个参考片段；无 tools、身份、问题文本、预测分数或写权限 |
| 声明校验 | 确定性结构、来源、主题与内容检查；无检索或模型调用权限 |
| 发布 | 图条件 + 提交时来源检查；模型不能选择下一节点、发布或确认业务写入 |

解释生成复用 `DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`、`CHAT_MODEL` 配置。
请求设定 max_tokens=2048；响应最多 64 KiB，正文最多 16000 字符，读超时 10 秒，接收循环总预算 15 秒。
缺配置、超时、截断、工具调用、无效响应均以受限结果结束，供应商错误正文不进入患者响应。
一次已提交的 DRAFT 恢复时不重新调用生成模型；失租约的生成结果无法提交。

## 声明与来源

首版采用保守的摘录式解释：生成模型选择可追溯的原文片段，不自动翻译或自由改写医学事实。
声明必须精确包含于其引用的已审核片段，引用 ID 必须真实，声明类型必须符合受控主题。
当前检索主题为 DISEASE_OVERVIEW，因此只发布一般疾病信息；风险提示与限制由程序生成。
拒绝无引用、虚构引用、无来源支持、主题不符、非法结构、数字声明、确诊措辞、治疗建议和提示注入痕迹。
这是工程声明门，不代表全面的医学语义证明或临床验证。

患者页面分别展示模型评估、一般参考信息、风险提示、来源与片段。
模型数值明确标为模型输出评分，不能解释为本人患病概率；未校准输出有单独提示。
引用含文档/片段 ID、审核版本、来源、原文及摘要校验标识，模型来源保留版本和权重指纹。
所有文本使用 Vue 转义插值，引用通过页内锚点定位，不将不可信来源转换成可执行 HTML 或外部链接。

来源在草稿前、声明校验、发布决策、提交和患者读取时重查 MySQL 受控属性。
发布提交时持有来源行锁并核对完整冻结引用集合；若图判断后来源变化，事务回滚并从原 checkpoint 重试，
不会提交陈旧的 PUBLISHED 状态。已发布来源撤回时，读取接口持有工作流锁，将快照持久扣留、
工作流降为 COMPLETED_LIMITED，并追加 EXPLANATION_WITHHELD 事件；重新审核资料不能使旧快照复活。

## 持久语义与 API

复用已存在的 V12 `t_explanation_snapshot`，不修改历史 Flyway SQL，也不新增自动建表或另一套数据库。
内容和推理包绑定不可变；revision、校验结果、引用摘要、validatedAt/publishedAt 与发布状态保存在业务库。

- 无草稿为 NONE；生成提交为 DRAFT；校验后为 VALIDATED 或 REJECTED。
- 只有 VALIDATED 且风险允许、冻结来源仍有效时才能 PUBLISHED。
- 发布前来源失效为 WITHHELD；已发布内容遇到撤回也持久 WITHHELD。
- REJECTED/WITHHELD 不可重新发布。COMPLETED 必须对应已发布且已校验快照。
- COMPLETED_LIMITED 只返回限制和追踪元数据，不返回 DRAFT 或仅 VALIDATED 的正文。
- 最终临床复核要求为 WAITING_HUMAN_REVIEW + VALIDATED，持久创建独立 FINAL_CLINICAL_REVIEW 任务，
  绑定推理包、工作流版本、图/动作版本和 checkpoint；没有可自动继续的 Job。
  最终复核操作及其批准/更正/不确定结果由工单 10 实施，本票不绕过复核。

所有者任务 API 和聊天绑定视图追加 `explanation` 元数据。
`result` 只包含正式发布的解释，`resultAvailability.patientVisible` 同步反映是否可展示。
患者 API 不暴露内部草稿、原始模型回复或校验失败内容；其他用户无权读取任务。
正式诊断表仍为空，解释内部快照自动保存不等同于用户批准保存诊断。

## 验证与边界

任务通过真实上传/查询 HTTP、LangGraph、SQLAlchemy、持久 checkpoint saver、Vue 与 Chromium 执行。
SQLite、Java 身份桥、COS、embedding、Chroma、推理模型、解释模型均为受控替身；没有向真实模型发出验证请求。

新增 HTTP 验证覆盖通过、证据不足、声明拒绝、非法结构、模型不可用/截断/越权工具调用、
来源在发布前/发布事务窗口/发布后撤回、重新审核不能复活、最终复核持久等待、失租约不能提交草稿。
患者页从选择图片创建任务，验证自动发布、证据不足、拒绝、等待复核、撤回扣留及逐项刷新恢复。
深色主题和 390px 解释区已截图检查；页面错误为零。
任务卡片背景改用现有双主题 `--claude-bg-card`，避免深色文字配浅色 fallback；浏览器同时核对正文对比度。
原站点导航栏在 390px 下存在横向溢出，本票新增解释区无溢出；不据此声明全站移动端验收通过。

命令（PowerShell 7；工作目录分别为 algorithm、frontend、仓库根）：

```powershell
$env:JAVA_HOME='C:/Users/yuwen/.jdks/corretto-21.0.7'
$env:Path="$env:JAVA_HOME/bin;$env:Path"
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
& .venv-baseline/Scripts/python.exe -m mypy web/workflow web/routers/workflow.py web/schemas/workflow.py --follow-imports=silent --ignore-missing-imports --check-untyped-defs
uv pip check --python .venv-baseline/Scripts/python.exe
npm exec vitest run
npm run build
mvn -o -q compile '-DskipTests'
```

浏览器复现：在独立测试端口启动 `python -m web.tests.validated_explanation_ui_server`（15281），
另启 Vite 15282 并设置 `VITE_API_BASE_URL=http://127.0.0.1:15281/api`，再运行：

```powershell
& .venv-baseline/Scripts/python.exe -m web.verify_validated_explanation_ui --output-dir ../.scratch/python-agent-migration/evidence/issue09
```

证据位于 `.scratch/python-agent-migration/evidence/issue09/`，包括 UI JSON、通过/不足/拒绝/等待/扣留截图，
以及深色与移动端截图。验证命令的最终结果在同目录 `verification.json`。
最终结果：Python Web 541 passed / 1 skipped，其中本票 HTTP 25 passed；前端 34 passed；
mypy 10 个文件、Vue 类型检查、生产构建、uv pip check（127 个包）、JDK 21 Java 基线编译通过。
按工单范围完成标准与验收语义自检；此记录不是独立临床审查或真实环境验收。
初次全量回归的两个 .doc 失败来自默认 Java launcher；显式切换项目规定 JDK 21 后通过，未改解析器。
前端构建保留既有大 chunk 提示。

真实 MySQL/Flyway、Redis、Chroma、Java 会话、真实模型权重与解释模型、临床复核、部署和回退未验证。
工单 08 的真实 MySQL 双连接测试因未提供隔离库跳过；SQLite 事务窗口测试不能代替 MySQL 并发验证。

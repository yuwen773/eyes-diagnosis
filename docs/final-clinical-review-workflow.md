# 工单 10：最终临床复核与受限发布

日期：2026-10-13。范围：仅 `py-rewrite`，基于当前工单 09 的解释快照实现。
状态：工程实现完成，ready-for-human；受控工程证据不代表真实临床或生产验收。

## 行为与决定矩阵

复用 `/api/reviews/tasks` 的队列、医生身份校验、领取、详情、图片与提交接口。
队列和页面分别标识 IMAGE_QUALITY_GATE 与 FINAL_CLINICAL_REVIEW。
质量决定只能继续或重传，不能代替最终临床复核。

| 原推理情形 | 允许决定 | 最终结果 |
|---|---|---|
| VALID_PREDICTION | CONFIRM_AI_ASSESSMENT | 原已校验解释通过当前来源校验后 PUBLISHED / COMPLETED；来源失效则 WITHHELD / COMPLETED_LIMITED |
| VALID_PREDICTION | CORRECT_AI_ASSESSMENT | 原解释 WITHHELD / COMPLETED_LIMITED |
| VALID_PREDICTION | INCONCLUSIVE | 原解释 WITHHELD / COMPLETED_LIMITED |
| SAFETY_ABSTENTION | CONFIRM_ABSTENTION | 无疾病预测、无解释快照，COMPLETED_LIMITED |
| SAFETY_ABSTENTION | PROVIDE_INDEPENDENT_REVIEW | 独立医生决定单独记录，不覆盖 AI 拒绝事实，COMPLETED_LIMITED |
| SAFETY_ABSTENTION | INCONCLUSIVE | 无疾病预测、无解释快照，COMPLETED_LIMITED |
| TECHNICAL_FAILURE | 无 | 不创建或接受临床复核 |

有效预测沿用工单 09 的最终风险门：需要复核的已校验解释暂停等待医生。
安全拒绝仅在已提交推理包明确 `requiresReview=true` 时进入最终复核；
其他安全拒绝继续按原行为受限结束。自由文本问题不改变路由。

确认、纠正、独立复核和无法判断均不再次执行推理、检索或解释模型调用。
医生操作只记录决定并提交一个恢复 Job；`finalClinicalReview` 图节点执行后续发布或受限结束。
发布许可不会修改冻结的 AI 风险判断、推理包、解释正文或来源字段。
医生批准不是用户保存授权，测试中正式诊断列表仍为空。

## 版本、权限和审计

- 仅服务端验证的 doctor 身份可以领取、查看详情与图片、提交。禁止自审、未领取提交、其他领取人操作。
- 校验 taskVersion、workflowVersion、图定义/hash/actionVersion、原包和已提交 checkpoint。
- 最终复核请求额外提交 `expectedExplanationSnapshotId` 与 `expectedExplanationRevision`；
  安全拒绝没有解释时两项为 null。拒绝已变化的快照 ID、版本、正文、校验结论和发布状态。
- 解释快照业务内容来自 MySQL；任务绑定的 checkpoint 用于核对它当时等待的具体快照，
  不用最新恢复点替换原复核上下文。不新增业务数据库或迁移历史。
- 决定和理由遵循 release ADR-004 的独立矩阵。额外 nextNode、modelAssessment 等字段被拒绝。
- 精确重复提交返回原回执；不同决定、理由或版本不能覆盖，只有一次医生提交事件与恢复效果。
- 医生领取/提交、解释发布/扣留保留追加审计事件。医生详情和患者 finalReview 返回受限审计投影，
  页面显示动作、时间和工作流版本；不输出其他用户资料、原始审计 payload 或患者未发布正文。
- 图版本为 `upload-final-clinical-review-v6`。旧 v5 等不兼容任务不会静默改用新图；
  本票没有迁移在途旧版本任务或执行部署。

## 验证证据

最终全量 Python Web：**559 passed / 1 skipped**，其中最终复核 HTTP 测试 **18 passed**。
唯一 skip 为已有受控证据测试未提供 `EVIDENCE_MYSQL_TEST_URL`，不能计入真实 MySQL 验收。
Python mypy：13 个源文件通过。前端：**36 passed**；Vue 类型检查和生产构建通过，保留既有大 chunk 提示。

新增 HTTP 用例覆盖六种决定、不兼容矩阵、权限/领取人、自审、过期版本、非法字段、
解释快照内容与校验结果变化、来源撤回、重复提交、同病例质量与最终复核独立执行。
逐字段核对原推理包保持不变；解释正文也保持不变，重建 Worker 不调用推理或解释模型。
等待最终复核可跨应用重建恢复，安全拒绝提交后由独立 Worker 进程完成，重放不产生第二次效果。

Chromium 从实际上传页面创建任务，经真实本地 FastAPI 路由、生产图和 SQL checkpoint saver，
操作实际医生页面完成六种决定；患者和医生页面刷新后均观察发布/扣留、决定与审计。
覆盖真实 409 路由冲突、精确重放、两类矩阵选项、深色主题、390px 新增详情区域。
六种路径推理包与模型调用次数均不变，页面脚本错误为零。
已查看发布患者页、扣留医生页及深色移动截图。已有全站导航在窄屏下横向溢出，
新增 `.clinical-detail` 区域无溢出；不宣称全站移动端通过。

**边界：** SQLite、Java 身份桥、COS、Chroma、embedding、推理和解释模型均为受控替身，
图片为合成测试图片。真实 MySQL 行锁/CAS/Flyway、Redis、Java 医生会话、真实模型、
专业医生临床验收、部署/回退均未执行。本票只覆盖 AC-07/11/12/21 的相关工程部分。

证据目录：`.scratch/python-agent-migration/evidence/issue10/`，包含测试日志、mypy、构建日志、
`ui-results.json`、六类医生/患者截图、冲突、深色与移动截图。

复现（PowerShell 7，工作目录 algorithm；全量 .doc 回归需要项目规定 JDK 21）：

```powershell
$env:JAVA_HOME='C:/Users/yuwen/.jdks/corretto-21.0.7'
$env:Path="$env:JAVA_HOME/bin;$env:Path"
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
& .venv-baseline/Scripts/python.exe -m mypy web/workflow web/routers/review.py web/schemas/review.py web/routers/workflow.py web/schemas/workflow.py --follow-imports=silent --ignore-missing-imports --check-untyped-defs
pwsh.exe -NoLogo -NoProfile -File web/run_final_clinical_review_ui.ps1
```

UI runner 使用隔离测试端口 15381/15382，将服务日志写入证据目录；启动前拒绝占用端口，
收尾核验监听进程 PID、名称、命令行后只停止自己的夹具/Vite。
前端目录运行 `npm exec vitest run` 与 `npm run build`。

范围自检：Java 源码、根构建、原迁移和源 spec 未修改；保留已有工单 09 及其他工作区改动，
没有提交、推送、发布或部署。此文档为工程自检记录，不是独立审查或临床批准。

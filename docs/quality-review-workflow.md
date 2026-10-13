# 工单 04：图像质量医生复核与恢复

实施日期：2026-10-13（Asia/Shanghai）。工作区：`py-rewrite`，分支：
`worktree-py-rewrite`。审查基点：`57e9db7d8f799ce6653758a53392aed2fc8ec9be`。
仅覆盖工单 04 对 AC-11、AC-12、AC-21 的相关部分，不代表整个迁移验收完成。

## 执行与数据

上传入口沿用生产 Worker 和 LangGraph。质量结果为 REVIEW 时，在提交该图分段的
同一受租约、fencing token 和工作流版本保护的事务中保存 `IMAGE_QUALITY_GATE`
任务与 checkpoint；不再自动投递下一个分段。复核使用 release 的
`OPEN → CLAIMED → SUBMITTED` 生命周期和 `APPROVE_CONTINUE / REJECT_RESUBMIT`
决定，不能提交最终临床复核的疾病确认动作。

任务绑定工作流、原推理包、图版本/哈希、动作版本和 checkpoint。
领取时同时递增任务与工作流版本；响应的 `workflowVersion` 是复核绑定版本。
提交必须携带实际看到的两个版本，且工作流仍等待对应质量复核。
角色、病例归属、领取医生和绑定均由服务端验证。新接口只允许 Java 会话
权威返回 `userRole=doctor` 的身份，管理员不自动继承医生权限，也不能自审。
没有新增或修改 Java 登录端点、角色授予页面或真实账号。

决定、复核状态、工作流入队、唯一恢复 Job 和医生审计事件在同一事务中提交，
响应前显式 commit。原领取医生重放完全相同的提交返回既有收据；不同决定或
版本不能覆盖已提交结果，也不创建额外 Job 或医生提交事件。

静态图中断的恢复 checkpoint 下一节点为 `qualityReview`：

`imageQuality → qualityReview → visionExposure → explanationUnavailable`

医生提交只调度恢复，不接受 nextNode 或修改 AI 字段。图根据持久决定判断：
允许后继续原影像可靠性检查，仍保留 OOD 等原始拒绝；重传后直接
`REJECTED / QUALITY_REJECTED`。两个分支均读取原 InferenceEnvelope，不调用
模型、不覆盖来源、不创建正式诊断记录。

质量通过后的证据和解释能力仍属于后续工单；当前有效预测继续时会明确结束为
`FAILED / EXPLANATION_NOT_AVAILABLE`。这表示工单 03 已保留的后续能力尚未实现，
不能将质量批准宣称为诊断完成。

## HTTP 与页面

新接口采用真实 401/403/404/409/422 HTTP 状态，成功为 BaseResponse。
Long/版本均以字符串传输，写入请求禁止额外字段。

| 接口 | 行为 |
|---|---|
| GET `/api/reviews/tasks` | 医生可领取及本人已领取的质量任务，排除自审、其他领取人与不兼容图；最多 100 项，页面说明该限制 |
| GET `/api/reviews/tasks/{taskId}` | 问题、质量快照、不可变推理来源及允许决定；不暴露疾病预测 |
| GET `/api/reviews/tasks/{taskId}/image` | 相同医生授权校验，返回原图，`Cache-Control: no-store` |
| POST `/api/reviews/tasks/{taskId}/claim` | `expectedTaskVersion`、`expectedWorkflowVersion` |
| POST `/api/reviews/tasks/{taskId}/submit` | 两个版本及 `decisionCode`、`reasonCode`；决定与理由须兼容 |
| GET `/api/diagnosis/workflows/{workflowId}` | 仅任务主人可读，新增 `qualityReview` 状态、决定与理由；原 `qualityGate` 模型事实不改变 |

前端医生入口为 `/doctor/reviews`，以 `?task=<id>` 恢复选中任务。
路由页面只组合功能面板；面板由数据 composable、任务列表和详情决策组件组成。
列表传入任务与 busy 状态，发出 select；详情传入复核快照与 busy，发出 claim/submit。
图片无法读取时不能提交；决定默认不选，重复点击受 busy 限制；失败后清除旧详情，
要求刷新服务端状态。患者页面显示医生已领取、允许继续或要求重传，并明确
医生复核不是用户保存授权、不是疾病确认。

## 部署边界

新增独立 Flyway 资产 V16，为 release V12 复核表补充版本与来源绑定字段；
V1–V15、Java 源码与根构建配置均保持不变。Web/Worker 不自动建表或迁移。
部署前按 [升级说明](../deploy/workflow-migrations/README.md) 执行 V16。

图与动作版本为 `upload-quality-review-v3`。旧 `upload-inference-v2` 未完成任务
不会静默采用新图；旧等待任务没有本票绑定，不能直接在新列表提交。
旧版本任务的升级或跨版本恢复需显式兼容方案，不以新图冒充旧 checkpoint。
本次没有执行真实数据库升级、安装部署、切流或修改原 spec。

## 验证证据

Python Web 全量回归 468 项通过，其中质量复核 HTTP 测试 20 项。
前端全量 21 项通过，mypy、Vue 类型检查与生产构建通过。
这些数字为本次本地工程回归，不是实际 MySQL 并发或模型验收。

质量复核 HTTP 测试经过真实 FastAPI 路由、鉴权 bridge、文件 SQLite、生产 Worker
与注册图，外部 Java/算法是替身。覆盖领取/提交、两种决定、匿名/普通用户/管理员/
自审/其他领取人拒绝、过期任务/工作流/图/checkpoint/来源绑定、额外字段、疾病确认
拒绝、重复提交、原推理包所有字段不变、算法只调用一次、保留 OOD 与正式记录数不增加。
额外重建 FastAPI 应用，并从独立操作系统进程执行 Worker，验证等待复核与提交后
恢复、持久任务/决定/审计和重复提交不新增恢复 Job。

Chromium 通过实际本地 HTTP 操作 Vue、FastAPI 与后台 Worker，使用独立 SQLite
及合成 Java 身份/推理。验证医生列表、详情、领取、两种决定、患者结果、刷新、
版本冲突和刷新恢复、普通用户拒绝及匿名跳转；无页面脚本错误。
本地测试替身不进入生产 app 的路由注册，也不代表真实 Java 登录。

证据：[结果 JSON](workflow/issue04-ui-results.json)、
[医生允许](workflow/issue04-approved-doctor.png)、
[患者允许后状态](workflow/issue04-approved-patient.png)、
[医生要求重传](workflow/issue04-rejected-doctor.png)、
[患者重传](workflow/issue04-rejected-patient.png)、
[版本冲突](workflow/issue04-version-conflict.png)。
双轴审查见 [审查记录](workflow/issue04-review.md)。

回归命令，在 `algorithm` 中运行：

```powershell
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_quality_review.py -q
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
& .venv-baseline/Scripts/python.exe -m mypy web/workflow web/routers/review.py web/routers/workflow.py web/schemas/review.py web/schemas/workflow.py web/verify_quality_review_ui.py web/tests/quality_review_ui_server.py --follow-imports=silent --ignore-missing-imports --check-untyped-defs
```

前端中运行 `npm exec vitest run` 与 `npm run build`。

浏览器复现（只允许本地测试环境）：在 `algorithm` 启动
`.venv-baseline/Scripts/python.exe -m uvicorn web.tests.quality_review_ui_server:app --host 127.0.0.1 --port 18804`。
前端设置 `VITE_API_BASE_URL=http://127.0.0.1:18804/api` 后运行
`npm run dev -- --host 127.0.0.1 --port 15174 --strictPort`。
随后在 `algorithm` 运行
`.venv-baseline/Scripts/python.exe -m web.verify_quality_review_ui --output-dir ../docs/workflow`。
需本地 Playwright/Chromium；这些工具不是生产依赖。fixture 模块含合成身份，禁止部署。

未验证：真实 MySQL V16 升级/事务/并发、真实 Java 医生会话、Redis/Chroma、
真实权重推理和生产部署。相关验收仍保留至后续工单，尤其 19–21。

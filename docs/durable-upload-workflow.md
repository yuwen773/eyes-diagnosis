# Issue 02 — 上传任务的持久执行最小闭环

日期：2026-10-13，Asia/Shanghai。起点：`0a098db1`，工作位置为
`.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。
范围为工单 02 及 AC-01、AC-02、AC-12、AC-22 的最小相关部分。
本票不代表模型、完整临床工作流或整个迁移 spec 验收通过。

## 可执行行为

上传页调用新增异步接口。MySQL 原子保存工作流、原始输入、幂等摘要、
READY 任务及追加时间线事件；提交成功后才返回 202。图片不经 COS，不在
Web 内调用模型，也不调用旧同步诊断端点。

独立生产 Worker 通过 `python -m web.workflow.worker` 运行，实际构建并执行
注册的 LangGraph：`START → validateImage → diagnosisUnavailable → END`。
无效图片从验证节点路由到 END，状态为 `REJECTED / INVALID_IMAGE`；有效
JPEG/PNG/WebP 完成解码验证后，经下一分段进入
`FAILED / DIAGNOSIS_NOT_AVAILABLE`。诊断推理将在工单 03 接入。
不存在默认类别、伪造 COMPLETED、未校验解释或自动正式诊断保存。

每个 Job 执行一个 Graph 分段。Worker 只使用公开 `get_state().next` 和
checkpoint config 创建通用 RESUME 任务，不维护临床路由表。业务 Workflow
保存状态与版本，MySQL checkpoint 仅保存继续执行信息。

checkpoint 适配器继承 LangGraph `BaseCheckpointSaver`，实现 `get_tuple`、
`put`、`put_writes` 和 `list`。执行期间仅暂存当前分段新写入，在有效租约、
fencing token 和 Workflow 版本校验后，将 checkpoint、pending writes、业务
状态、事件、Job 结果和后续 Job 在同一 MySQL 事务提交。新 Worker 实例读取
Workflow 绑定的已提交 token，无需原进程的内存。图版本、拓扑摘要或动作
版本不兼容时明确 FAILED，不静默重放旧图。

租约使用 MySQL 时间；任务支持到期重新领取和有限技术重试。图执行不持有
数据库事务。本票验证了真实 MySQL 的分段恢复路径；双 Worker 竞争、慢模型
超时、完整 fencing 故障矩阵和副作用幂等仍由工单 16 验证。

## HTTP 契约

| 方法/路径 | 输入 | 成功 | 失败 |
|---|---|---|---|
| `POST /api/diagnosis/workflows` | multipart `file`、`idempotencyKey`；可选 `question` | 202，`{code:0,msg:"ok",data:WorkflowStatusView}` | 401 未登录；409 同键不同内容；413 空/过大输入；422 参数错误；500 技术错误 |
| `GET /api/diagnosis/workflows/{workflowId}` | 路径任务标识 | 200，相同任务状态视图 | 401 未登录；403 非本人；404 不存在；500 技术错误 |

身份已于完整迁移工单 02 改为 Python EYE_SESSION → Redis → 当前 t_user 逐请求验证（原 Java 鉴权描述已取代）。不同用户的幂等键空间独立，客户端不能
指定 owner、角色或下一节点。幂等摘要绑定图片字节和问题文本，同键不同内容
明确冲突。新接口使用真实 HTTP 错误码，旧业务接口 HTTP-200 错误封装不变。

视图包含 `workflowId,status,workflowVersion,graphDefinitionVersion,segment,progress,
stopReasonCode,resultAvailability,result`。版本为十进制字符串；progress 只展示
已提交步骤。本票始终 `patientVisible=false`、`doctorReviewRequired=false`、
`result=null`。FastAPI OpenAPI 的两个操作绑定类型化响应模型。

前端仅替换诊断页上传入口，保持原页面风格。`WorkflowUploader` 管理选图表单，
`WorkflowStatus` 通过 props 展示状态，`useUploadWorkflow` 管理提交、轮询与资源
释放。查询使用 URL 的 `workflow` 参数，刷新或重建页面会重新向服务端查询；
页面无模拟百分比或报告生成计时。网络提交失败后的原页面重试复用原幂等键。

## 依赖、迁移与启动

Python 3.11；实际验证解释器 3.11.17。直接锁定 LangGraph 1.2.12 和
langgraph-checkpoint 4.3.0，全部间接依赖位于 `algorithm/requirements-web.lock`。
使用当前锁文件运行而不是任意解析宽泛版本。兼容接口依据
[LangGraph checkpoint 文档](https://docs.langchain.com/oss/python/langgraph/persistence)，
并以本次本地执行和跨进程测试验证。

数据库部署使用 [独立 Flyway 资产](../deploy/workflow-migrations/README.md)。
V1–V9、Java 源码和原 `pom.xml` 均未修改；V10–V14 与 release 原文件一致；
V15 增加 Python 输入与恢复表。Web 启动不自动建表。

```powershell
# PowerShell 7；从迁移 worktree 的 algorithm 目录执行。
uv pip sync --python .venv-baseline/Scripts/python.exe requirements-web.lock
# 设置 MYSQL_*、SESSION_*、REDIS_* 和 CORS_ALLOWED_ORIGINS 等本地配置。
& .venv-baseline/Scripts/python.exe -m uvicorn web.app:app --host 127.0.0.1 --port 8080
# 另开受监督的进程运行 Worker，退出/部署后由监督器重新启动：
& .venv-baseline/Scripts/python.exe -m web.workflow.worker
# 一次执行一个分段，适用于部署验证：
& .venv-baseline/Scripts/python.exe -m web.workflow.worker --once
```

完整迁移工单 02 后，三个会话端点及 diagnosis 路由均转发 Python 8080，Nginx 前门 8081。
本文原上传工单的证据保留历史身份；当前身份验证见 [Python 登录鉴权](python-session-auth-evidence.md)。
Python Worker 仅领取 `python-graph` 通用分段任务，保留旧队列给其原执行器。
生产只启用预期的任务执行器，避免旧 Java Worker 和 Python Worker 同时领取
共享任务队列；整套部署编排与回退仍由工单 20 交付。

## 可复现验证

单元/接口测试使用 SQLite 文件库与外部 Java HTTP transport double，实际调用
生产 Worker 与注册图；跨进程测试启动独立 Python 解释器，不使用内存 saver。
前端测试在真实组件/路由边界模拟 HTTP transport，验证创建后重建组件查询原任务。

```powershell
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_workflow.py -q
& .venv-baseline/Scripts/python.exe -m mypy web/workflow web/routers/workflow.py web/schemas/workflow.py web/middleware.py web/verify_workflow.py --follow-imports=silent --ignore-missing-imports --check-untyped-defs
# frontend 目录：npm exec vitest run；npm run build
```

真实验收使用经本次确认的隔离 schema `eye_workflow_issue02`、两个合成账号、
MySQL 8.0.26（3307）、原 Java（8082）、隔离 Redis（16379）、空 Chroma（18000）、
Nginx 1.28.0（8081）与 Vite（5173）。Chroma 仅满足原 Java 启动，不代表检索验收。
账号按 [工单 01 基线](fastapi-baseline.md) 方法创建，凭据保存在忽略的本地文件。

先运行 Flyway，再启动 Java/Redis/Chroma/Nginx/Vite。将 `MYSQL_DATABASE` 设置为
隔离的 `eye_workflow_*` schema；其他 MYSQL_* 配置与 Java 使用同库。保持
8080 空闲，不另启动 Worker。下方验证器仅管理它自己创建的 Web/Worker/浏览器：

```powershell
& .venv-baseline/Scripts/python.exe -m web.verify_workflow `
  --login-file ../.scratch/workflow-runtime/login.json `
  --other-login-file ../.scratch/workflow-runtime/other-login.json `
  --output-dir ../.scratch/workflow-runtime/evidence
```

结果与截图须检查后再归档，不提交凭据或原始服务日志。验证器复用同一 MySQL，
重建 Web 四次和 Worker 四次，检查 202、幂等、跨用户隔离、内容冲突、排队重启、
已完成分段恢复、明确不可用且正式记录不增加、页面创建任务与刷新恢复、
Worker 提交期间幂等响应一致，以及 Web/浏览器重建后页面查询原任务，共 11 项。
本次 HTTP 快照记录同一任务 `QUEUED(v0) → RUNNING(v2) → FAILED(v4)`。

归档见 [真实检查结果](workflow/issue02-live-results.json) 与
[刷新后的上传页](workflow/issue02-restored.png)。输入为程序生成的 PNG，
没有临床图片、模型权重或推理输出。正式诊断记录数前后相同。

最终回归：Python Web 全量 428 项通过；前端 4 个文件的 13 项测试通过；
新增模块 mypy、依赖一致性检查、前端类型检查与生产构建通过。
Flyway 在隔离 MySQL 完成 V1–V15 升级，再次 validate/migrate 无新增变更；
原 Java 在升级后的隔离库正常启动。双轴审查复审均无遗留问题，详见
[审查记录](workflow/issue02-review.md)。本次未执行生产切流。
定位交付提交：
`git log -1 --format=%H -- docs/durable-upload-workflow.md`。

## 保留的验收边界

本票不接入 PyTorch 推理、证据、解释发布、人工复核、用户保存确认、聊天/SSE
共享、取消或临床等待恢复。真实模型成功诊断与完整诊断流程仍未验证。
新任务的正式诊断保存需要后续用户确认流程，技术快照自动保存不等于正式记录。
生产切流、数据保留策略、完整并发与崩溃故障矩阵属于后续工单，不由本票宣称完成。

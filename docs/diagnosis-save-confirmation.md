# 工单 11：正式诊断保存确认

实施目录：`.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。
状态：受控工程验证；真实 MySQL、Java 会话联调、模型与部署验收另行执行。

## 行为与边界

患者结果页先请求并查看拟保存内容，再单独点击批准或拒绝。预览包括本次图片、
图片摘要、模型评估、解释全文、引用、严重程度未评估标记和有效期。确认有效期为
数据库时间起 30 分钟；服务端判定过期，客户端时间不能授权保存。

生成确认请求仅写入 `t_diagnosis_save_confirmation`。用户批准后才写入
`t_diagnosis`，并同时建立 `t_saved_workflow_diagnosis` 回执。完整解释、引用和
获批内容版本保留在确认快照中；既有诊断表存兼容的摘要与推理来源字段，不向其
512 字符摘要列截断塞入整份解释。图片复用 MySQL 已持久化的原始输入，无须在
预览或批准过程中再次调用模型、检索服务或 COS。

只保存 `COMPLETED` 且当前解释确已校验并发布的有效预测。必要质量复核必须
`APPROVE_CONTINUE`，最终临床复核必须 `CONFIRM_AI_ASSESSMENT`。等待复核、
安全拒绝、被纠正、无法判断及其他受限结果不能经用户批准保存为疾病诊断。
医生批准不会产生用户确认或正式记录；图与临床状态不因保存请求改变。

确认绑定 Java 当前认证用户、工作流、`SAVE_DIAGNOSIS`、创建幂等键、工作流
版本、解释快照及版本、完整内容 SHA-256。批准接口不接收客户端诊断内容，
重新锁定任务并检查归属、发布、临床决定、图片与推理输入摘要、当前内容版本和
来源有效性。来源撤回时沿用既有扣留逻辑。变更后旧确认标为 `INVALIDATED`，
必须刷新结果并重新请求确认。拒绝和过期分别保留 `REJECTED`、`EXPIRED`。

同一任务加锁串行化保存操作；条件更新确认状态，并通过工作流唯一回执防止重复
正式记录。确认、正式记录与回执在一个事务中提交。失败回滚后仍可重试；已提交
批准仅返回同一回执。过期、拒绝、内容冲突、跨用户请求均不产生正式记录。
确认独立保存，不复用医生任务、图 checkpoint 或 `WAITING_HUMAN_REVIEW`。
聊天、进度、解释快照和审计保持自动持久化，旧同步诊断接口保留原行为。

## HTTP 契约

所有接口位于 `/api/diagnosis/workflows/{workflowId}` 下，沿用统一响应 envelope。

| 方法与后缀 | 行为 |
| --- | --- |
| GET `/save-confirmation` | 当前确认或已保存回执；无确认返回 null，读取时检查过期 |
| POST `/save-confirmation` | 绑定幂等键、预期工作流版本、解释快照 ID 与版本，返回冻结预览 |
| POST `/save-confirmations/{confirmationId}/approve` | 绑定原幂等键、内容摘要及工作流版本，重新检查并保存一次 |
| POST `/save-confirmations/{confirmationId}/reject` | 同样绑定原确认，拒绝且不建正式记录 |
| GET `/image` | 原始图片；患者仅自己的图片，管理员仅额外读取已保存且未删除的正式记录图片 |

未登录为 401、跨用户为 403、不存在为 404，状态/版本/幂等冲突为 409，
未知字段或非法输入为 422。Long ID 和工作流版本通过字符串返回。
现有 Java 三个会话端点未改；每个保存请求仍经 Java 验证当前登录身份。

## 数据升级与保留

新增部署资产 `deploy/workflow-migrations/sql/V20__diagnosis_save_confirmation.sql`；
由既有独立 Flyway 流程升级。未修改 Java 源码、构建配置及 V1–V19。
应用启动不创建表。保留确认、回执和被正式记录引用的原始图片，回退时保留新表。
正式记录图片是需登录的 API URL；前端在不同 API 主机开发配置下解析该 URL，
既有 COS 图片 URL 原样使用。部署路由须继续把这些工作流接口交给 Python。

## 验证

使用现有 `.venv-baseline`，Python 测试的 Java 子进程显式使用仓库指定 JDK 21。
HTTP 测试从上传、Worker、实际图执行得到已发布结果，再测试确认流程。
覆盖自动发布与医生批准后发布、预览不写入、拒绝、过期、错用户、错资源、错操作、
错幂等键、版本或内容变化、来源撤回、写入异常回滚与重试。
独立 API 进程从磁盘 SQLite 恢复待确认/已批准状态，并执行两个进程并发批准，
核对正式记录只有一条。该测试不构成真实 MySQL 并发验收。

Chromium 运行实际 Vue 页面与 HTTP API/Worker，覆盖上传、完整预览、拒绝、过期、
批准、重复批准、刷新恢复、跨用户和医生等待门禁；检查图片可加载、窄屏保存区无
横向溢出、深色主题及脚本错误。图片使用红色合成 PNG，不是真实患者数据。
整页窄屏仍有既有导航布局溢出，保存区本身无溢出；本票未修改导航。

证据：`.scratch/python-agent-migration/evidence/issue11/`。
测试统计见该目录日志及 `issue11-ui-results.json`。

结果：Python Web **572 passed / 1 skipped**；最终保存确认用例 **13 passed**；
前端 **42 passed（11 个文件）**；Vue 类型检查、生产构建及工作流范围 mypy
**14 个源文件通过**。浏览器脚本错误 0。跳过项为未配置隔离库的真实 MySQL 集成。

复现命令（PowerShell 7）：

```powershell
# 在 algorithm 目录；Java 子进程必须使用 JDK 21。
$env:JAVA_HOME='C:/Users/yuwen/.jdks/corretto-21.0.7'
$env:Path="$env:JAVA_HOME/bin;$env:Path"
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
& .venv-baseline/Scripts/python.exe -m mypy web/workflow web/routers/workflow.py web/schemas/workflow.py web/schemas/confirmation.py --follow-imports=silent --ignore-missing-imports --check-untyped-defs
# 在 frontend 目录。
npm.cmd run build
npm.cmd run test -- --run
# 在 worktree 根目录；仅启动本地受控服务，并核实 PID/命令后回收测试进程。
pwsh.exe -NoLogo -NoProfile -File algorithm/web/run_save_confirmation_ui.ps1
```

未执行真实 MySQL V20 升级、MySQL 锁竞争、Redis/Java 会话服务联调、真实模型、
生产部署、回退或临床验收。已有 MySQL 集成用例缺少隔离数据库 URL 时跳过。
不将 SQLite、身份桩、受控 Chroma/embedding/COS/模型的通过外推为真实服务通过。

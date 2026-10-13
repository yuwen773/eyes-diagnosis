# 工单 06：聊天与上传共享诊断任务

日期：2026-10-13（Asia/Shanghai）；范围为本票 AC-01/14/21 的相关部分。
实现基点：`97b6e1dc686c3fe1d1966c3a3d89f0b1d2766f30`。

## 使用方式与契约

原聊天输入框增加“受控图片诊断（单张）”。勾选并发送一张图片即可创建受控任务。
普通聊天、多附件和原有样式继续保留；自由文本不自动启动工作流或改变临床路由。
从诊断页“在聊天中继续此任务”进入聊天后，显式点击“关联到当前对话”。两页读取
同一个 Workflow 标识、进度、失败与患者结果投影，聊天不会再调用另一套推理管线。
已关联任务可在聊天任务选择器切换，也能从聊天跳转回诊断页。

`POST /api/agent/chat/stream` 保留普通聊天请求与 assistant/done/error SSE，新增可选字段：

```json
{"message":"本次说明","threadId":"session-id","diagnosis":{"imageUrl":"已上传且属于本人的附件URL","idempotencyKey":"operation-key"}}
```

或关联/查询已有任务：

```json
{"message":"","threadId":"session-id","diagnosis":{"workflowId":"workflow-id"}}
```

创建与关联互斥；诊断操作最多4000字、一个附件，不接受内部下一节点参数。
会话、附件、Workflow 均校验服务端登录身份；已绑定其他会话的附件不能用于本会话。
已有任务允许其所有者显式引用到另一会话，不自动导入原会话症状或模型记忆。
关联操作不改变原始 question、临床状态、推理 epoch、医生决定或正式诊断记录。

诊断分支返回 `event: workflow`，data 是 `{sessionId,workflow}`，随后 `event: done`。
done 只表示本次创建/关联命令受理，不表示临床任务完成。持续进度来自现有
`GET /api/diagnosis/workflows/{workflowId}`；普通聊天仍使用原模型流。
`GET /api/agent/history/{threadId}` 增加 `workflows`，逐次从业务存储读取授权任务状态。
任务消息子类型为 workflow，不进入普通模型上下文；不会把模型输出当成任务状态。

聊天沿用旧 HTTP 200 + `{code,msg,data}` 错误封装；相同键不同输入返回
`code=50001` 和明确冲突文案，越权 `40101`，非法结构 `40000`。上传仍为202，冲突409。
两入口调用同一 `web.workflow.service.create_or_get`，使用相同的用户范围幂等键和
图片字节+question 摘要。跨入口重放必须携带原键、原图片和原说明；新操作使用新键。

Workflow、初始 Job、排队事件和聊天关联在响应前提交。重复绑定不重复写任务消息。
聊天 SSE 不执行临床图，只展示受理后的服务端投影；既有生产 Worker 继续驱动图。
页面刷新读取服务端历史与状态。sessionStorage 按登录用户隔离，仅保存尚未确认的诊断请求内容和键，
响应丢失后可重试同一请求；它不保存或证明任务完成。发送诊断失败不删除可能已被
服务器绑定的图片。待确认请求可在切换对话后返回原会话重试；过期历史响应不能覆盖
新会话的任务关联。普通聊天的错误/停止契约保持原样。

## 数据库与部署

执行独立 Flyway V18（见 `deploy/workflow-migrations/README.md`）后再部署此版本。
新关联表主键为 sessionId/workflowId；不新增诊断记录表、任务队列或数据库。
新聊天上传将已经验证且不超过2 MiB的原始输入持久化到 MySQL，创建任务时直接使用
同一字节输入，不下载任意 URL。历史附件原图列为 NULL 时继续支持普通聊天；诊断创建
明确要求重新上传。既有 Java 源码、根构建配置、旧迁移和三个 Java 会话端点均未修改。
回退保留 V18 资产和关联，不删除数据。未切流、部署或修改现有业务数据库。

## 验证

在 algorithm 目录运行：

```powershell
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_chat_workflow.py -q
& .venv-baseline/Scripts/python.exe -m web.verify_chat_workflow_ui --output-dir ../docs/chat-workflow
```

真实MySQL回归设置 `CHAT_WORKFLOW_TEST_MYSQL_URL` 为本机专用的
`eye_chat_issue06_` 前缀测试schema，再运行同一HTTP测试文件。先用独立Flyway完成升级；
夹具不会建MySQL表，会清空该专用schema中的本票聊天/工作流测试行，禁止指向业务库。

后一个命令管理自己的18805/15175测试进程，端口占用则拒绝启动；使用临时SQLite、
合成Java身份/模型/COS，停止和重建自己的后端，结束后清理进程。截图与
[9项页面结果](chat-workflow/issue06-ui-results.json)记录跨入口幂等、共享失败、页面切换、
刷新、后端重启、上传任务绑定、丢失响应后的重试和普通聊天分支。
缺权重明确显示MODEL_UNAVAILABLE，查询/重放不重新执行图，无正式诊断写入。

HTTP/SSE回归覆盖5项新增场景；全量Python 488项和前端25项通过，类型检查与构建通过，
详见[最终审查记录](chat-workflow/issue06-review.md)。
独立MySQL 8.0.26 schema `eye_chat_issue06_20261013_f1a49ab5` 完成V1–V18的
Flyway migrate/validate，5项新增HTTP/SSE回归通过、无skip，详见
[MySQL证据](chat-workflow/issue06-mysql-results.json)。身份、COS及聊天模型仍为替身；
没有修改正式业务数据库，也没有据此验收真实模型或Java全链路。
新增代码的mypy检查通过。对整个旧Web目录执行mypy仍有既存域/测试类型错误，
本票不修改无关代码，不将局部检查写成整个旧目录通过。

本票不提供已发布解释，患者结果继续使用已有安全投影（result=null）。真实模型、
真实Java登录/COS、真实服务切流与回退及整个spec验收仍未完成；模拟测试和浏览器
检查不替代这些验收。临床复核和用户正式保存确认由各自工单完成。

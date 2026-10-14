# 工单 12：补充说明的暂停与恢复

在已经关联诊断任务的聊天中，选择“补充本次说明”。聊天接口发出 `supplement` SSE 事件后发出既有 `done` 终止事件，交互图停在 `waitForDescription` 的 `interrupt()`。此处的 `done` 表示本次流已结束，不表示等待请求已完成。普通聊天模型输出的追问文字不会自动创建请求，也不通过自由文本识别症状或选择临床节点。

这是独立的交互等待：临床工作流继续遵循原有状态和图路由，`WAITING_HUMAN_REVIEW` 始终表示医生复核。回复不会重新推理、发布解释、提交复核或保存正式诊断。正式记录仍由工单 11 的用户确认控制。

## HTTP 契约

| 操作 | 请求 | 返回 |
| --- | --- | --- |
| 发起等待 | `POST /api/agent/chat/stream`，`threadId`、`message`、`supplement: {workflowId, idempotencyKey}` | SSE `supplement` 包含 `requestId/sessionId/workflowId/status/version/items/answer`；随后 `done` |
| 查询原请求 | `GET /api/agent/supplements/{requestId}` | 原请求及等待版本 |
| 恢复交互 | `POST /api/agent/supplements/{requestId}/reply`，`sessionId/workflowId/expectedVersion/text` | 原请求的 `ANSWERED` 回执及新版本 |
| 刷新恢复 | `GET /api/agent/history/{sessionId}` | 原消息、任务和 `supplements` 列表 |
| 医生查看 | 既有 `GET /api/reviews/tasks/{taskId}` | `supplementaryNotes`，原说明 `question` 保持不变 |

标识符和版本使用字符串。回复仅接受 1–4000 字的非空白文本，禁止 `nextNode`、症状字段和审批参数。错误沿用 Agent 的 Java 兼容 `BaseResponse`：未登录 `40100`、越权 `40101`、参数错误 `40000`、过期等待版本或冲突 `50001`，均由 `code` 判断。

## 持久化与幂等

- MySQL `t_python_chat_supplement` 为交互业务事实来源；同一会话只允许一个 `WAITING` 请求。请求按会话和幂等键去重，幂等键不能用于另一任务或不同原始消息。
- 沿用 `MysqlCheckpointSaver` 与 `t_python_graph_checkpoint/write`，以 `supplement:{requestId}` 隔离图线程，业务行保存已提交 checkpoint 指针及 `chat-supplement-v1` 版本。创建请求、checkpoint 和消息在同一事务提交。
- 回复先检查身份、未删除会话、原任务关联、等待版本、图版本及 checkpoint 绑定，再使用 `Command(resume=text)` 恢复。检查与写入持有会话/请求锁，状态更新另有版本 CAS；checkpoint、回执和消息一起提交。
- 相同原版本和相同文字的重试返回已提交回执；不同文字、不同版本不能覆盖。旧回执重试不会消费后来创建的新请求。等待不会通过轮询、应用重建或后台 worker 自动重放原输入。
- 补充文字作为普通用户消息保存，只进入当前会话的聊天上下文；医生详情通过原任务关联读取。临床图、原说明、推理包、解释快照及正式诊断记录均不使用这些文字作路由条件。

## 迁移与回滚

部署前通过独立的 workflow Flyway 路径应用 V21（须已有 V15–V20），不得在生产调用 `metadata.create_all`。回滚保留补充请求与 checkpoint 表，关闭新入口即可；恢复同版本应用后可继续原等待。Java 源码、构建配置和三个会话端点未调整。

## 验证边界

`algorithm/web/tests/test_supplement.py` 通过聊天/SSE、回复和历史 API 检查等待、幂等、越权、版本检查、重建应用、当前会话上下文及医生展示；不直接调用 intake 节点。

`algorithm/web/verify_supplement_ui.py` 使用原 Vue、真实 HTTP/SSE、持久文件 SQLite 和真实后端进程重启，检查浅色/深色/窄屏回复入口、刷新恢复、回复回执丢失后的幂等重试以及新会话隔离。证据位于 `.scratch/python-agent-migration/evidence/issue12/`。

这些是受控工程证据：Java 身份、COS 和聊天模型均为替身。真实 MySQL V21 迁移与并发锁、Java/Redis 集成、真实模型及生产部署回滚尚未验收；不代表整个 AC-12 或迁移 spec 已通过。

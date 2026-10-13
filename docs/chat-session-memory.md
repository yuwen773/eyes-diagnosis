# 工单 05：普通聊天与当前会话记忆

日期：2026-10-13（Asia/Shanghai）。实现范围为工单 05 的 AC-02/03/14/15 相关部分。
审查基点由用户确认：`60c9d8e4ad062576e35d6f3a02ba2d9d1582013a`。
交付定位：`git log -1 --format=%H -- algorithm/web/routers/agent.py`。

## 实现与契约对账

对照原 `AgentController`、`AgentImageUploadController` 和前端实际请求，Python 承接以下
11 个方法/路径。三个登录态端点继续由 Java 承接；原 Java 源码、根 pom 和旧迁移不变。

| 方法与路径（均以 `/api/agent` 开头） | 行为 |
|---|---|
| POST `/chat/stream` | `message/threadId/imageUrls`；assistant 增量 SSE；成功 `event: done`，失败 `event: error` 且无 done |
| GET `/history/{threadId}` | `beforeId/limit`；messages/hasMore/nextCursor；新增 imageUrls 与 executions |
| GET `/sessions` | 用户自己的会话；`beforeId/limit`，置顶优先 |
| DELETE `/sessions/{sessionId}` | 验证归属后逻辑删除，不复活已删除 ID |
| DELETE `/sessions/batch` | `sessionIds`；先验证所有归属，再原子逻辑删除 |
| PUT `/sessions/{sessionId}/title` | `title`，非空且至多 50 字 |
| PUT `/sessions/{sessionId}/pin` | `pinned`；持久化置顶状态 |
| POST `/sessions/{sessionId}/generate-title` | `firstMessage`；受限模型生成标题，不写进聊天记忆 |
| GET `/history/{sessionId}/export` | markdown/json 字符串；包含已绑定附件 |
| POST `/image/upload` | multipart `file`；JPEG/PNG、2 MiB 上限；COS URL 字符串 |
| POST `/image/upload/delete` | `url`；仅清理本人未绑定附件；已进入历史的附件保留 |

普通响应保持 `{code,msg,data}`、成功 `msg=ok`、业务错误 HTTP 200。
Long ID/历史游标是 JSON 字符串，日期沿用 Java Date 的既有格式与转换。
历史按 ID 稳定排序并返回最新一页的时间正序，向前游标不重叠；这修正了原实现首屏取
最早消息和混合时间排序导致的分页问题。session 列表排序/`beforeId` 语义保持原样。
前端游标类型同步为 string；普通聊天页面加载最新 100 条，不将页面显示上限用于模型上下文。

未提供或传空 threadId 时服务端生成 ID，并通过 `X-Session-Id` 返回。
新会话初始标题使用首条文本前 50 字；显式 generate-title 调用执行模型标题生成。
原 Java 在保存用户消息时另行触发自动 AI 标题生成，本实现不在每次首轮聊天额外调用模型；
会话标题编辑与显式生成接口仍保留。MCP 工具执行属于工单 14/15：普通聊天不加载默认工具，
显式非空 enabledMcpServers 返回明确的“尚未启用”错误，不假装执行成功。

## 记忆、身份与持久化

`t_agent_session` / `t_agent_message` 继续作为历史来源。每轮调用模型前，读取**该会话**的
USER 与成功 ASSISTANT 的 text/旧 NULL 子类型消息，按顺序真实装入模型请求，然后追加本轮用户输入。
未复制其他会话或历史诊断，也不把摘要、工具输出、Java checkpoint blob 当作新病例事实。
既有 Java 文本历史可继续使用；不会反序列化 Java checkpoint。

会话和附件归属均使用 Java 逐请求验证的用户身份。浏览器传 userId 不参与授权。
新附件由 MySQL 记录其上传用户，首次发送时绑定会话和消息；跨用户、跨会话及任意 URL
均拒绝。切流前已上传但尚未发送的 Java 对象，仅凭同一 COS host 和 `t_upload_task`
中的本人 PERSISTED/COMPLETED 记录接纳；不只检查 URL 中的用户前缀。
原 Java 没有把 imageUrls 写入用户历史，因此历史中本来就缺失的旧附件关联无法自动重建；
本票新发送的附件能够跨重启恢复。COS 仍为原公开 URL 存储方式，本票未改变桶访问策略。

V17 增加执行结果、附件绑定和追加审计表，不新增第二套业务数据库、不使用内存记忆验收。
用户消息/STARTED 在外部调用前提交；模型正常完成后才原子保存完整助手消息/COMPLETED。
模型 HTTP 错误、截断、非法事件、非 stop 终止和空回答均失败关闭；错误细节、密钥和原始
用户文本不写进审计。停止生成记为 INTERRUPTED。被进程终止遗留的 RUNNING，在该会话
下一次读取/发送且超过 130 秒截止时间后记为 INTERRUPTED，不自动重放模型请求。
同会话的唯一 activeSessionId 防止回答交错；单次外部流总限时 120 秒，不持有业务事务。
这些是普通聊天执行结果，不是临床 Workflow 状态或可靠诊断 Job。

普通问答没有算法、工作流 Worker、临床复核或正式诊断写入工具。附件随会话上下文传给
配置的多模态聊天模型，但提示词要求图片诊断引导到受控上传入口，不声称运行或保存诊断。
聊天与工作流绑定、来源校验后的正式解释、历史诊断按需查询仍由后续工单交付。

## 配置、切流与复现

保持 Python 3.11 及现有 `requirements-web.lock`，未新增依赖。
设置 `DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`（compatible-mode，可带 /v1）、
`CHAT_MODEL`（默认 qwen-vl-plus，须支持所需图片输入），以及既有 COS 配置。
未配置密钥时聊天明确失败，Web 启动与既有业务仍可用。真实提供方能力尚未验收。

先按 `deploy/workflow-migrations/README.md` 使用 JDK 21 执行独立 Flyway migrate/validate，
再启动 Python 并应用 `deploy/nginx.conf`。Agent 两个 location 改为 Python，SSE 继续关闭缓冲；
三个登录态 location 保持 Java。这里交付的是配置资产，没有切换任何现有服务。
回退时停止 Python 聊天流并将两个 Agent location 同时指回 Java，保留数据库与附件。
Java 仍能读取原会话/文本表，但原 Java 页面不能恢复新增附件关联或 Python 执行状态；
完整回退与 Java V17 启动仍需工单 20/19 验证，不删除新表或改写 Flyway 历史。

在 algorithm 目录执行：

```powershell
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_chat.py -q
# 真实数据库用单独新建的合成测试 schema，先执行 Flyway，禁止指向业务库。
# CHAT_TEST_MYSQL_URL=mysql+pymysql://<user>:<password>@127.0.0.1:3307/eye_chat_issue05_<suffix>
# 测试会清空该专用 schema 的聊天/上传夹具，不自动建表或删除 schema。
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_chat.py -q
```

页面复现：Vite 在 15175 启动，`VITE_API_BASE_URL=http://127.0.0.1:18805/api`、
`VITE_APP_API_BASE_URL=http://127.0.0.1:18805`。然后运行
`python -m web.verify_chat_ui --output-dir ../docs/chat`。
验证器只启动/终止自己的 18805 fixture，临时 SQLite、模拟身份/模型/COS，不可部署。

## 验证证据与限制

- 聊天 HTTP/SSE：15 项通过，含可控模型两轮上下文、重建应用、既有 Java NULL 子类型行、权限、
  附件、模型失败、审计与同会话并发；SQLite 和真实 MySQL 分别执行。
- 独立 MySQL 8.0.26：`eye_chat_issue05_20261013` 的 Flyway V1–V17 migrate/validate
  通过，15 项 HTTP 用例通过、0 skipped。见 [数据库证据](chat/issue05-mysql-results.json)。
- Chromium/原 Vue/实际 HTTP/SSE：7 项通过、无 pageerror，含独立后端进程重启、
  附件刷新恢复与停止生成。见 [页面证据](chat/issue05-ui-results.json) 及同目录截图。
- 本票 9 个 Python 模块 mypy 通过；前端流终止回归 3 项通过。
- COS 接线回归实际构造锁定 SDK 的 CosS3Client，仅替换 put_object/delete_object 远端操作；
  该通过结果不代表真实 COS 上传验收。
- 最终全量回归与双轴审查在收尾提交中记录；此处不将此前测试数字冒充本轮结果。
- Java 身份、DashScope、COS 在上述测试中为替身。真实 Java V17 启动/登出重放、真实
  模型回答与 COS、实际 Nginx 切流/回退未验收；MySQL 测试不替代这些边界。
- 这些证据仅完成工单 05 的相关部分，不代表 AC-01–22 或完整 Python Agent 迁移验收。

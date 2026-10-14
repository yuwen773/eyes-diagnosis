# 工单 13：按需查询带来源的历史诊断

日期：2026-10-14（Asia/Shanghai）。目标工作树 `py-rewrite`，分支 `worktree-py-rewrite`。
实现与审查基点：`3c93181cb7f630871591ab8c24df94f2b45dde87`；仅审查本票文件。
范围：AC-02、AC-03 中的历史诊断查询部分。

## 行为与授权

现有 `POST /api/agent/chat/stream` 不增加必填参数，普通聊天继续使用 assistant/done/error SSE。
模型请求获得一个 `query_diagnosis_history` 函数工具，只有模型按需选择工具后才查询 MySQL。
查询已存在的 `t_diagnosis`，不依赖本次或新工作流先保存诊断，也不读取其他聊天会话。

工具参数仅允许可选的字符串 `recordId`。未提供时按保存时间、ID 降序展示最近10条；
存在更多记录时明确显示并非全部历史，可以提供记录 ID 查询更早记录。
SQL 始终同时限制服务端 Java 登录身份 `userId` 与 `isDelete=0`，包括管理员聊天。
浏览器传入的身份不参与查询授权，工具中的额外身份/写入参数、非法 ID 均拒绝。
指定其他用户、已删除或不存在的 ID 得到相同的“未找到本人可访问的记录”，不泄漏存在性。

服务端直接生成带记录 ID、保存时间（既有 Java Date 协议的 UTC）、来源表和受权详情 API
路径的回答。AI 结果和人工复核状态/结论分列；已拒绝 AI 判断不展示旧 AI 结论。
返回结果不再交给模型改写，因此结果、空记录和查询失败不会被模型加工成虚构记录。
数据库故障明确说明“查询失败，无法据此判断是否存在历史”，不当作无历史；不公开异常详情。

结果以 `diagnosis_history` 消息保存在当前聊天，原页面可展示、刷新载入和导出。
这个子类型不进入普通聊天模型记忆；后续再次引用历史时需要重新查询。
因此既往症状和结论不会自动变成本次病例事实，查询结果也不上传给外部模型。
聊天消息和执行审计仍按现有规则自动保存；历史查询不创建 Workflow/Job、不修改任务输入、
不修改正式诊断、不产生保存审批。没有改动临床图路由或原 Java 源码、根 pom、源 spec。

## 模型协议与部署

沿用锁定的 httpx SSE 适配器，合并分片工具参数，校验工具名、类型、索引、终止原因与大小。
每次只允许一个历史只读工具，不开放任意函数或 MCP 写入；未知、截断、超限或混合
文本/工具响应失败关闭，不保存完整成功回答。标题生成不加载历史工具。
历史读取在独立线程及独立数据库会话内执行，避免慢查询阻塞异步聊天与其他 HTTP 请求；
取消聊天不会让读取线程使用聊天事务。MySQL 驱动连接超时5秒，读写超时10秒，避免故障连接无限占用。

默认聊天模型由 `qwen-vl-plus` 更新为 `qwen3-vl-plus`，已有 `CHAT_MODEL` 环境变量仍可覆盖。
显式覆盖值必须支持图片输入与 OpenAI compatible 流式工具调用。旧默认没有出现在当前
[提供方官方工具支持清单](https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling)
中；新默认在清单及多模态示例中。真实账号的区域、权限、实际工具选择准确率仍待验收。
本票没有新增依赖、迁移、数据库或部署操作；沿用现有聊天迁移和 Java 逐请求身份验证。

## 复现与验收边界

在 `algorithm` 目录，使用已有 Python 3.11 环境：

```powershell
$env:JAVA_HOME = 'C:\Users\yuwen\.jdks\corretto-21.0.7'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
& .venv-baseline/Scripts/python.exe -m pytest web/tests/test_history_retrieval.py -q
& .venv-baseline/Scripts/python.exe -m mypy web/chat/history.py web/chat/model.py web/routers/agent.py web/config.py web/db.py --follow-imports=silent --check-untyped-defs
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
```

本票测试通过聊天 HTTP/SSE 验证已有历史来源、Long ID、用户/管理员隔离、伪造参数、
无登录、跨用户会话、无记录、查询故障与恢复、普通问答不查诊断、历史不进入后续病例记忆、
当前任务与正式记录不变、无诊断入队、AI拒绝判断、人工来源、结果条数和指定旧记录查询。
额外用同一 ASGI 事件循环验证：数据库读取延迟期间，健康检查仍能及时响应。
使用真实临时 SQLite、合成历史记录与 Java/模型 HTTP 传输替身；不把它视为真实模型验收。

最终测试数量与双轴审查见 `history-retrieval-review.md`。
真实 MySQL/Java/DashScope 联调、原 Vue 页面的本票浏览器检查及临床验收尚未执行。
工单交付为 `ready-for-human`，不代表整个 AC-02/03 或完整迁移 spec 已验收。

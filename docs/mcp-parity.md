# Python 聊天 MCP 工具与图像推理（工单 14）

实现位于 `py-rewrite`，只处理 MCP 只读工具选择、调用及图像推理适配。Java 源码、构建与三个会话端点保持原状；源 spec 未修改。

## 选择与权限

- 非空 `enabledMcpServers` 覆盖默认选择，包括 `disableMcpDefault=true` 时。
- 未指定或传入空列表时，默认选择当前登录用户 `status=1` 的服务；`disableMcpDefault=true` 禁用这些默认服务。
- 显式选择非本人、禁用或删除的服务会拒绝整次请求；请求中的 `userId` 不授予权限。
- 发现、调用前、发送 HTTP 请求前以及结果展示前重新读取服务归属、状态、配置和连接策略。配置变更使当前连接失效，下一轮重新发现；不使用跨用户缓存。
- 仅接受白名单 HTTPS 的 `SSE` / `STREAMABLE_HTTP`；禁止 STDIO、用户信息 URL 和重定向。SSE 返回的消息提交地址还必须与原服务同源。

## 只读工具授权

`MCP_ALLOWED_ORIGINS` 继续指定逗号分隔的 HTTPS 来源。新增运维环境变量 `MCP_READONLY_TOOLS`，格式为逗号分隔的 `serverCode/toolName`，例如：

```text
MCP_ALLOWED_ORIGINS=https://mcp.example.org
MCP_READONLY_TOOLS=<用户的服务代码>/lookup,<用户的服务代码>/eye_disease_diagnosis
```

默认清单为空。只有经运维核实无业务副作用的工具才能加入；用户保存的 deployConfig、远端 `readOnlyHint=true`、模型输出均不能授予此权限。远端显式声明 `readOnlyHint=false` 的工具仍拒绝使用。无注解的旧只读工具可经运维清单批准。会修改诊断、审批、发布或其他业务事实的工具不得加入；统一确认接入属于工单 15。

工具以服务代码和工具名组成的稳定哈希别名提供给模型，避免跨服务重名。参数按照远端 JSON Schema 验证，并拒绝身份、工作流、发布和确认字段。输入与输出 Schema 均使用禁止网络解析的 Registry，仅本地引用可解析；调用使用 SDK 的公开协议接口，避免 SDK 默认输出验证器自行读取外部引用。结果由系统直接展示，不回传模型改写；外部资料注明来源性质，保存为 `mcp_tool` 消息，下一轮不自动作为本次病例事实进入模型上下文。

## SSE、错误和预算

聊天入口仍为 `POST /api/agent/chat/stream`。新增 `event: tool`，包含 `tool` 别名（调用开始/成功时）及 `status: STARTED / SUCCEEDED / FAILED`。失败事件包含安全错误码，例如 `MCP_TIMEOUT`、`MCP_DISCOVERY_FAILED`、`MCP_TOOL_FAILED`、`MCP_ACCESS_REVOKED`、`MCP_CALL_BUDGET_EXCEEDED`。

成功结果沿用 assistant 消息与终止 `event: done`。工具失败发送失败事件及 `event: error`，执行记录为 FAILED，不保存成功回答，不发送 done，也不泄漏上游错误细节。既有前端能展示结果和失败；新增工具事件供 API 调用方观察。

每轮最多选择 8 个服务；发现阶段总期限 10 秒，每个服务最多 32 个工具；需要分页的发现列表明确报预算不足。工具参数最多 4096 字符，Schema 最多 8192 字符，结果最多 16000 字符。每轮最多执行一次模型选择的工具调用，多工具和循环调用拒绝执行；调用期限 10 秒，聊天整体期限沿用 120 秒。超时不会自动重试，也不授权任何业务写入。

## 图像与来源

`eye_disease_diagnosis` 现在调用与上传 Worker 相同的 `WorkflowInference` / `InferenceEngine`，复用质量、校准、安全拒绝、权重注册与来源校验。删除旧 MCP 独立概率差启发式及其专用测试，以工具公开边界的回归替代。

统一读取 `MODEL_WEIGHTS_PATH`、SHA、registry、校准和版本配置。`MODEL_PATH` 仅作为旧名称兼容；显式旧配置与统一权重路径冲突时拒绝配置。仅接受共享的 EfficientNet-B4 / 8 分类管线，不寻找其他默认权重，也不使用未训练模型。缺权重、指纹不符和执行异常分别失败，不能转为临床拒绝或诊断成功。

聊天只能指定当前用户、当前会话已绑定且未删除的持久附件 URL；服务端读取 MySQL 附件字节并转换 Base64。模型不能指定本地文件、任意远端 URL、任意 Base64 或其他会话附件。图像返回必须匹配输入摘要、模型/预处理/策略版本，以及已配置时的权重指纹。

MCP 服务仅返回未发布分析的质量、结果状态和来源元数据，固定 `patientVisible=false`、`publication=UNPUBLISHED`。聊天端再次按允许字段投影，剔除标签、概率、TopK 和描述；不创建正式诊断、不修改图路由或发布条件。查看临床结果仍须原受控工作流、证据与复核门禁，正式保存另需用户确认。

## 验证范围

`web/tests/test_mcp_chat.py` 经真实聊天 HTTP/SSE 与受控 Java/model/MCP 传输验证选择、隔离、撤销、Schema、防扩权、预算、错误、墙钟超时、附件与预测隐藏。

`web/tests/test_mcp_transports.py` 启动本机官方 FastMCP HTTPS 服务，以临时证书、真实 TCP/TLS 分别验证 SSE 和 Streamable HTTP 的发现及调用；测试后关闭自有服务，不占用产品端口。身份和模型仍受控，不能据此声称已通过真实 Java/MySQL/外部 MCP 或真实模型验收。

`web/tests/test_mcp_image.py` 经 MCP 工具公开入口和受控推理引擎验证来源一致、质量/拒绝、缺权重及技术失败。真实权重、临床有效性、生产外部工具和真实基础设施验收尚未执行。

## 执行结果（2026-10-14）

- 本票专项：`pytest web/tests/test_mcp_chat.py web/tests/test_mcp_transports.py web/tests/test_mcp_image.py -q`：44 passed。
- 完整 Python Web/MCP 回归：`pytest web/tests mcp_server/tests -q`：670 passed、1 skipped、1 warning，105.08 秒。运行时设置 `JAVA_HOME=C:\Users\yuwen\.jdks\corretto-21.0.7` 并前置其 bin 路径，供现有 Word 解析测试使用；初轮未设置该路径时两项 Word 解析失败，设置后均通过。
- 类型检查：7 个变更生产模块，`mypy --follow-imports=silent --ignore-missing-imports --check-untyped-defs` 通过。
- `uv pip check --python .venv-baseline/Scripts/python.exe`：133 个包兼容；`git diff --cached --check` 通过。
- 唯一 warning 来自 SDK/Pydantic settings 的 lifespan 前向引用；本机 HTTPS 传输与工具入口测试均通过，未据此扩大为生产兼容性验收。
- 两名独立审查者复审后 Standards / Spec 均 0 项遗留，详见 `docs/mcp-parity-review.md`。

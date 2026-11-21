# AI 模型调用清单（CFG-AUDIT-02）

**基线：** `f42065e4c38a94f4d1acd81f7cdbe15ad9c7f683`　**日期：** 2026-11-16
**范围：** Java 后端全部真实模型调用与客户端构造；Python 算法服务的推理入口；React 前端无模型调用
**配套：** `configuration-inventory.md`（配置侧证据）

> 凭据只记录**来源**，不记录值。本分支不含多 Agent 代码；`6ba65478` 的调用点单列于 §4。

---

## 0. 结论摘要

| 结论 | 证据 |
|---|---|
| 所有模型客户端都在 Spring 上下文启动时**静态绑定** | 无 `@RefreshScope`、无 `Environment` 重读、无 `ModelResolver` |
| 只有 MCP 客户端是「每次调用从数据库读配置」 | `MCPManager.java:54-90` |
| 客户端分三类：自动配置注入 / 手工 `@Bean` / `@PostConstruct` 里手工构造 | 见 §1 |
| 视觉客户端与 gRPC 客户端最僵硬，构造后无任何替换缝隙 | `EyeImageAnalyzerTool.java:60-71`、`DiagnosisGrpcClient.java:26-33` |
| 存在一个「名为 LLM、实为截断」的占位实现 | `TitleGenerationService.java:46-53` |
| 运行时真实模型 ID **无法从 tracked 源码证明** | `application.yml` 无 `spring.ai.*` 块；`local,dev` profile 未入库 |

---

## 1. 调用点清单（本分支）

| callSite | what is called | taskType | providerSource | modelSource | credentialSource | lifecycle | runtimeBinding | medicalRisk |
|---|---|---|---|---|---|---|---|---|
| `agent/tools/EyeImageAnalyzerTool.java:60-71` | `OpenAiApi.builder()` → `OpenAiChatModel.builder()` → `ChatClient.builder()` | Vision | yml `eye-diagnosis.vision-recognition.base-url` | yml `.model` = `qwen-vl-plus` | yml `.api-key`（tracked 为占位字面量；部署示例解析 `DASHSCOPE_API_KEY`） | `@PostConstruct`，单例 | **否**——`@Value` 绑定后不再变化 | **是**：患者眼底图 |
| `EyeImageAnalyzerTool.java:85-88` | `visionChatClient.prompt().call()` | Vision | 同上 | 同上 | 同上 | 单例 | 否 | 是 |
| `agent/DiagnosisAgent.java:75-76` | 注入 `ChatModel` | Chat / Agent | 自动配置 `OpenAiChatAutoConfiguration`（`spring.ai.openai.base-url`） | `spring.ai.openai.chat.options.model` = `qwen3.5-plus`（仅示例模板） | `spring.ai.openai.api-key` → `DASHSCOPE_API_KEY` | 单例 Bean | 否 | 是：医学对话文本 |
| `DiagnosisAgent.java:94-103` | `ReactAgent.builder().model(chatModel).methodTools(...)` | Agent | 同上 | 同上 | 同上 | **每次请求**重建图 | 否——图重建但模型是单例 | 是 |
| `DiagnosisAgent.java:130` | `activeAgent.stream(...)` | Agent | 同上 | 同上 | 同上 | 每请求 | 否 | 是 |
| `agent/config/VectorStoreConfig.java:32-36` | `new ChromaApi(url, …)` | Embedding 存储 | yml `spring.ai.vectorstore.chroma.client.host/port` | — | 无 | 单例 Bean | 否 | 是：医学知识向量 |
| `VectorStoreConfig.java:39-46` | `ChromaVectorStore.builder(chromaApi, dashscopeEmbeddingModel)` | Embedding | Chroma 键 + 自动配置 | `spring.ai.dashscope.embedding.options.model` = `text-embedding-v3` | `spring.ai.dashscope.api-key` → `DASHSCOPE_API_KEY` | 单例 Bean（构造时捕获 EmbeddingModel） | 否 | 是 |
| `agent/tools/DocumentSearchTool.java:44-48` | `@Autowired(required=false)` 注入 `VectorStore`、`RerankModel` | Embedding / Rerank | 自动配置 | `spring.ai.rerank.options.model` = `gte-rerank-v2` | `DASHSCOPE_API_KEY` | 单例 | 否 | 是：医学证据检索 |
| `DocumentSearchTool.java:89,91,164` | `vectorStore.similaritySearch(...)` | Embedding | 同上 | 同上 | 同上 | 单例 + 每用户 60s 缓存 | 否 | 是 |
| `DocumentSearchTool.java:113` | `rerankModel.call(rerankRequest)` | Rerank | 自动配置 | `gte-rerank-v2` | `DASHSCOPE_API_KEY` | 单例 | 否 | 是 |
| `service/impl/DocumentProcessingService.java:35-36,114` | `vectorStore.add(chunks)` | Embedding | 同上 | 同上 | 同上 | 单例 + 异步 ETL | 否 | 是：医学文档 |
| `agent/rag/BuiltinCorpusSeeder.java:46-47,101` | `vectorStore.add(...)` | Embedding | 同上 | 同上 | 同上 | 启动时一次（`seed-enabled=true`） | 否 | 是 |
| `BuiltinCorpusSeeder.java:154` | `vectorStore.similaritySearch(...)` | Embedding | 同上 | 同上 | 同上 | 启动时 | 否 | 是 |
| `service/impl/KnowledgeBaseServiceImpl.java:289-292,350-353` | `vectorStore.delete(chunkIds)` | VectorStore（无推理） | 同上 | — | 无 | 单例 | 否 | 是：删除医学向量 |
| `grpc/DiagnosisGrpcClient.java:28-32` | `ManagedChannelBuilder…usePlaintext()` + `newBlockingStub` | Classification-gRPC | yml `diagnosis.grpc.host/port` | Java 侧记录 `eye-diagnosis.inference.model-version` = `efficientnet-b4@1.0.0`；实际权重由 Python 决定 | 无（明文、无鉴权） | `@PostConstruct`，单例 | **否** | **是**：患者影像与诊断结果 |
| `DiagnosisGrpcClient.java:41-43` | `withDeadlineAfter(...).diagnose(request)` | Classification-gRPC | 同上 | 同上 | 无 | 单例 | 否（deadline 每请求读配置） | 是 |
| `service/impl/DiagnosisServiceImpl.java:253` | `diagnosisGrpcClient.diagnose(...)` | Classification-gRPC | 同上 | 同上 | 无 | 单例 | 否 | 是 |
| `agent/manager/MCPManager.java:54-90` | `McpClient.sync(transport)`（Streamable HTTP / SSE） | MCP-tool | **数据库** `t_mcp_server`（用户配置） | 远端 MCP 服务决定 | 数据库 `deployConfig.headers/env` | **每次调用构造、用完关闭** | **是**——DB 读取 + Origin 白名单每调用校验 | 是：外部工具可收到医学文本/影像 |
| `MCPManager.java:119` | `client.listTools()` | MCP-tool | 同上 | 同上 | 同上 | 每调用；工具列表 Redis 缓存 5min | 是 | 是 |
| `MCPManager.java:171-173` | `client.callTool(...)` | MCP-tool | 同上 | 同上 | 同上 | 每调用 | 是 | 是 |
| `agent/mcp/McpToolCallback.java:52-55` | → `mcpManager.callTool` | MCP-tool | 同上 | 同上 | 同上 | 每工具调用 | 是 | 是 |
| `agent/service/TitleGenerationService.java:46-53` | **无模型调用**（截断占位） | Chat（占位） | — | — | — | 单例 | n/a | 低 |

---

## 2. 注入 vs 手工构造

| 类型 | 实例 | 未来 `ModelResolver` 能否拦截 | 说明 |
|---|---|---|---|
| Spring 自动配置注入 | `ChatModel`（`DiagnosisAgent.java:75`） | **容易** | `DiagnosisAgent` 注入接口并传入 `ReactAgent.builder()`；替换 Bean 即可 |
| 自动配置注入 | `EmbeddingModel`（`VectorStoreConfig.java:39`） | **较难** | `ChromaVectorStore` 在构造时捕获实例；需重建 `VectorStore` 或用委托包装 |
| 自动配置注入 | `RerankModel`（`DocumentSearchTool.java:47-48`） | 中等 | `required=false`，缺失时静默关闭 rerank |
| 手工 `@Bean` | `VectorStore` / `ChromaApi` | 中等 | 需要改 `VectorStoreConfig` |
| `@PostConstruct` 手工构造 | 视觉 `OpenAiApi`/`OpenAiChatModel`/`ChatClient`（`EyeImageAnalyzerTool.java:60-71`） | **不能**（无缝隙） | 需改成工厂注入或每次请求解析 |
| `@PostConstruct` 手工构造 | gRPC `ManagedChannel`/stub（`DiagnosisGrpcClient.java:26-33`） | **不能** | 同上 |
| 每次调用构造 | MCP client（`MCPManager.java:54-90`） | 已是动态 | 配置来源是数据库而非 yml |

**结论：** 第一期不做 Model Router；只记录「未来接入点在 `DiagnosisAgent.buildAgent`、`VectorStoreConfig`、`EyeImageAnalyzerTool` 构造处、`DiagnosisGrpcClient.init`」四处，且不新增空接口/空类。

---

## 3. 模型 ID / Base URL / 凭据来源字面量

| 字面量或键 | 位置 | 备注 |
|---|---|---|
| `https://dashscope.aliyuncs.com/compatible-mode` | `application.yml:98`、`application-server.example.yml:37,71` | 视觉与 Chat 各有一份 |
| `qwen-vl-plus` | `application.yml:100`、`application-server.example.yml:73` | 视觉模型 |
| `qwen3.5-plus` | `application-server.example.yml:41` | **只在模板里**，Java 不校验 |
| `text-embedding-v3` | `application-server.example.yml:48` | 只在模板里 |
| `gte-rerank-v2` | `application-server.example.yml:51`；`application.yml:115`（**死键**） | 真正生效的是 `spring.ai.rerank.options.model` |
| `efficientnet-b4@1.0.0` | `application.yml:93`、`DiagnosisServiceImpl.java:85` | Java 记录值，Python 实际选择权重 |
| 视觉温度 `0.2` | `EyeImageAnalyzerTool.java:63` | 硬编码 |
| Chat 温度 `0.3` | `application-server.example.yml:42` | 模板 |
| `DASHSCOPE_API_KEY` | `application-server.example.yml:38,44,72` | 三条模型栈共用同一环境变量名，可静默分叉 |
| `your-api-key-here` | `application.yml:99` | tracked 占位符，非真实密钥 |
| `10` / `15` | `AgentConstants.java:12-13` | `maxIterations` / `modelCallLimit`，**注入后无人读** |

---

## 4. Agent 与多 Agent

### 4.1 本分支（单 Agent）

- `DiagnosisAgent` 是单例 `@Component`；每次请求 `buildAgent` 新建 `ReactAgent`，挂一个系统提示词 + 两个方法工具（`EyeImageAnalyzerTool`、`UserBoundDocumentSearchTool`），再追加 MCP `ToolCallback[]`。
- SSE 入口 `AgentController.chatStream`。
- **无按角色分配模型**；`ReactAgent.builder()` 未设迭代/工具调用上限，`AgentConstants` 的两个上限值未接线。
- 多 Agent 代码（`collaboration/`、`patientdraft/`）**不在本分支**。

### 4.2 多 Agent 分支 `6ba65478`（未合并，仅做定点扫描）

| callSite | taskType | 说明 |
|---|---|---|
| `patientdraft/DraftAgents.java:46-68` | Chat（结构化输出） | `Transport` 包装注入的 `ChatModel`；用 `instanceof OpenAiChatModel / DashScopeChatModel` 分支改 `retryTemplate`，然后 `model.call(new Prompt(..., options))`，`maxTokens(4000)` 硬编码 |
| `patientdraft/PatientDraftCoordinator.java:70-74` | Agent | 构造器注入同一个 `ChatModel` |
| `agent/tools/EyeImageAnalyzerTool.java`（该分支） | Vision | 与本分支同构：`@PostConstruct` 手工构造 |
| `agent/DiagnosisAgent.java:80` | Chat / Agent | 注入 `ChatModel`，同构 |

该分支新增配置键：`agent.tool-audit.enabled`、`agent.tool-audit.digest-key`（**默认值里含 dev 密钥字面量**）、`eye-diagnosis.collaboration.cursor-key`、`security.same-origin.additional-hosts`。
**处置：** 合并后必须重新跑本清单；配置中心第一期**不得**声称已覆盖多 Agent 模型路径。

---

## 5. 占位 / 假实现

| 位置 | 声称 | 实际 |
|---|---|---|
| `TitleGenerationService.java:26-53` | 注释写「调用 LLM 生成标题」 | 只是截断首条消息并拼「关于「…」的对话」；`TODO: 后续接入 DashScope` |

配置中心不得把这个占位实现登记为「模型调用」。

---

## 6. Python 推理路径

| callSite | taskType | modelSource | lifecycle | medicalRisk |
|---|---|---|---|---|
| `algorithm/grpc_server.py:84-85` | Classification | `MODEL_WEIGHTS_PATH` + `model_name='efficientnet_b4'` | 启动 | **高** |
| `algorithm/grpc_server.py:106` | Classification | 已加载模型 | 每请求 | 高 |
| `algorithm/eye_disease_model.py:523-528` | 权重加载 | 调用方路径，`weights_only=True` | 启动 | 高 |
| `algorithm/mcp_server/tools.py:31-38` | Classification | `MODEL_PATH` 或内置默认路径 | 启动 | 高 |
| `algorithm/mcp_server/tools.py:64` | Classification | 全局模型单例 | 每请求 | 高 |
| `algorithm/mcp_server/image_handler.py:50` | MCP 工具（远程取图） | — | 每请求（30s 超时） | 中高（无 URL 白名单） |
| `algorithm/eye_diagnosis/frozen_eval.py:109-110` | Classification（离线评估） | `--weights` | CLI | 高（指标可信度） |

Python 侧**没有** Chat / Embedding / Rerank 调用；这些全部在 Java。MCP 服务只暴露影像分类器。

---

## 7. 风险与歧义

1. **运行时模型 ID 不可从 tracked 源码证明**：`application.yml` 无 `spring.ai.*`，`local,dev` profile 未入库。
2. **同一 DashScope 账号有三条凭据来源**（`spring.ai.openai.api-key`、`spring.ai.dashscope.api-key`、`eye-diagnosis.vision-recognition.api-key`），可静默分叉。
3. **两个 base URL**：Chat 与 Vision 各一份，改一个只影响一半。
4. **Rerank 模型键是死键**：`eye-diagnosis.rag.rerank.model` 无人读，改它无效。
5. **静默降级**：`VectorStore` / `RerankModel` 都是 `required=false`；缺失时检索悄悄退化为无 rerank，不报错。
6. **Embedding 换模型不重建索引**：向量空间变了，Chroma 里的旧向量不重算，检索质量静默下降。
7. **Java/Python 版本信任边界**：`DiagnosisEvidence.java:58-63` 优先采信 Python 响应里的版本/SHA，而不是 Java 配置；Python 侧换模型会静默改变医学证据与缓存指纹。
8. **明文 gRPC**：`usePlaintext()`，无 TLS/鉴权；仅当 host 保持 localhost 才安全。
9. **视觉失败会产出合成医学结论**：异常时返回 `urgency: attention` + 「图像分析失败」（`EyeImageAnalyzerTool.java:89-98`），Agent 可能把它当作模型结论转述。
10. **生成参数硬编码**：视觉温度 `0.2`；Chat 温度只在模板里。
11. **Agent 护栏未接线**：`maxIterations` / `modelCallLimit` 注入但无人读，框架默认值生效。
12. **Chroma tenant/database 的 yml 是死键**，运维会误以为改过。
13. **MCP 可触达外部模型工具**：白名单只约束 Origin，不能约束远端行为。
14. **`qwen3.5-plus` 未校验**：只存在于模板，抄错不会启动失败，只会在调用时报错。
15. **混合检索默认值相反**（代码 `false` vs yml `true`）。
16. **知识库 ETL 可在无向量时标记成功**：`vectorStore == null` 时只 warn，仍 `updateStatus(1, chunkCount)`（`DocumentProcessingService.java:113-118`）。

---

## 7.1 后续确认（2026-11-16，定向修订）

- 第 7 节的第 8 条（明文 gRPC）与第 9 条（视觉失败合成 `attention` 结论）已提升为**独立运行时安全风险**，在 `phase0-review.md` §5.1 以 `SEC-RUNTIME-02` / `SEC-RUNTIME-01` 跟踪；它们不因 WP-00 通过而放行生产。
- 多 Agent 分支只做了定点扫描；合并前必须全量重跑本清单（`phase0-review.md` P1-12）。
- Provider 连接元数据的发布语义（草稿修订 + 发布快照引用）不改变本清单的任何调用点：第一期仍不接执行路径。

## 8. 对配置中心的约束

1. 第一期 Provider 连接**只存元数据**；不得改动任何模型构造代码。
2. 不得把 `eye-diagnosis.vision-recognition.api-key` 之类敏感键做成可回显字段。
3. 连接测试不得复用生产模型客户端；必须是独立、受限的探测请求。
4. 未来 Model Router 的接入点已登记（§2），但第一期不建空接口。
5. 多 Agent 分支合并后必须重跑本清单，并把 `DraftAgents.Transport` 纳入登记。

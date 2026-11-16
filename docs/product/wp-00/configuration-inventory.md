# 配置项清单（CFG-AUDIT-01）

**审计基线：** `f42065e4c38a94f4d1acd81f7cdbe15ad9c7f683`（`feat/system-config-center`，含 `ui` tip `6ae633b8`）
**审计日期：** 2026-11-16
**审计范围：** `src/main/java`、`src/main/resources`、`src/test`、`algorithm/`（运行时服务优先）、`web/src`、`web/index.html`、`web/vite.config.ts`、`docker-compose.yml`、`scripts/`、`.github/workflows/`
**方法：** 按 PRD §6 的关键字扫描 + 逐文件打开核对；表中每一行都有可打开的 `file:line`。`frontend/`（Vue）已弃用，仅在其可能被误认为现行配置源时记录。

> 本清单只记录**位置与语义**，不记录任何凭据值。本工作树里不存在 `application-local.yml` / `application-dev.yml` / `application-server.yml`（均被 `.gitignore` 忽略，worktree 不继承）；主检出目录里存在这三份，其中 `application-local.yml` 含真实 DashScope 与 COS 凭据字面量——本文件不复制其内容。

---

## 0. 结论摘要

| 指标 | 数值 |
|---|---|
| Java 侧可辨识配置键 | 55（含 6 个测试/环境变量） |
| Java 侧消费绑定 | 58 处 |
| Python 运行时配置键 | 17（另有 9 类硬编码策略参数） |
| React 侧构建期环境变量 | **1**（`VITE_API_BASE_URL`） |
| 已识别的多重事实来源 / 死配置 / 缺口 | 22 条（Java 15 + Python 6 + 前端 1） |
| 当前真正「运行时可动态解析」的配置 | **0**——所有 `@Value` / `@ConfigurationProperties` 都在 Bean 初始化时绑定，仓库内无 `@RefreshScope`、无 `Environment` 重读 |

**一句话结论：** 配置面是「散在 yml + 代码默认值 + 环境变量 + 硬编码字面量」的混合体，存在可验证的重复事实来源；配置中心必须先立边界，再谈动态化。

---

## 1. 分类口径

| 分类 | 含义 | 能否进配置中心 |
|---|---|---|
| `DEPLOY_ONLY` | 端点、凭据、端口、连接池、存储位置；改它等于改部署形态 | 只登记，不可动态改 |
| `DYNAMIC` | 业务可调参数，改动不改变安全边界与数据语义 | MVP 候选（品牌、Provider 元数据） |
| `STATIC_POLICY` | 安全策略、推理指纹、行为开关；必须随发布/部署固定 | 只登记，不可动态改 |
| `SECRET_REF` | 只允许引用受控密钥来源（`env:NAME`），永不存明文 | 只登记引用名 |

生命周期取值：`startup-bound`（启动/Bean 初始化）、`per-request`、`scheduled`、`per-test-run`。

---

## 2. Java / Spring 配置

### 2.1 服务与框架（DEPLOY_ONLY / STATIC_POLICY）

| configKey | sourceFile | consumer | purpose | classification | lifecycle | risk | migrationDecision |
|---|---|---|---|---|---|---|---|
| `server.port` | `application.yml:3` | Spring Boot | HTTP 端口 8081 | DEPLOY_ONLY | startup | 中 | 保留 |
| `server.servlet.context-path` | `application.yml:5` | Spring Boot | 统一 `/api` 前缀 | DEPLOY_ONLY | startup | 高（前端 BASE_URL 依赖） | 保留 |
| `server.servlet.session.cookie.max-age` | `application.yml:7-9` | Spring Session | Cookie 30 天 | STATIC_POLICY | startup | 高 | 保留 |
| `spring.profiles.active` | `application.yml:15-17` | Spring Boot | 默认 `local,dev` | DEPLOY_ONLY | startup | 高 | 保留 |
| `spring.flyway.*` | `application.yml:20-26` | Flyway | schema `diagnosis`、校验开启 | DEPLOY_ONLY | startup | 高 | 保留 |
| `mybatis-plus.configuration.map-underscore-to-camel-case` | `application.yml:29` | MyBatis Plus | **必须为 false**（列名小驼峰） | STATIC_POLICY | startup | 高 | 保留 |
| `spring.servlet.multipart.max-file-size` | `application.yml:14` | Spring MVC | 框架层 10MB | DEPLOY_ONLY | startup | 中（与应用层 2MB 冲突，见 M9） | 保留 |
| `spring.datasource.*` | `application-server.example.yml:4-8`、`application-ci.yml:2-6` | Spring | MySQL 连接 | DEPLOY_ONLY | startup | 高 | 保留（永不动态） |
| `spring.session.store-type` / `spring.data.redis.*` | `application-server.example.yml:13-26` | Spring Session / Redis | 会话存储 | DEPLOY_ONLY | startup | 高 | 保留（永不动态） |
| `spring.jackson.*` | `application-server.example.yml:9-12` | Jackson | 日期格式 | STATIC_POLICY | startup | 中 | 保留 |
| `springdoc.*` / `knife4j.*` | `application.yml:39-54` | 文档组件 | Swagger/Knife4j | DEPLOY_ONLY | startup | 低 | 保留 |
| `logging.level.*` | `application.yml:55-58` | Logback | 日志级别 | DEPLOY_ONLY | startup | 低 | 保留 |

### 2.2 安全边界（STATIC_POLICY，永不可由数据库覆盖）

| configKey | sourceFile | consumer | purpose | classification | lifecycle | risk | migrationDecision |
|---|---|---|---|---|---|---|---|
| `app.cors.allowed-origins` | `application.yml:73-75` | `config/CorsConfig.java:11,18,28` | 精确 Origin 白名单 | STATIC_POLICY | startup | **高** | 保留 |
| `mcp.remote.allowed-origins` | `application.yml:61-63` | `agent/policy/McpConnectionPolicy.java:18` | 远程 MCP Origin 白名单，空=全拒 | STATIC_POLICY | startup | **高** | 保留 |
| `mcp.executor.core-size` / `max-size` / `queue-capacity` / `timeout-seconds` | `application.yml:64-68` | `agent/config/AgentExecutorConfig.java:16-20` | MCP 线程池 | DEPLOY_ONLY | startup | 中 | 保留 |
| `mcp.executor.per-server-max` | `application.yml:69` | `agent/manager/MCPManager.java:43,141-142` | 单 MCP 服务并发信号量 | DEPLOY_ONLY | startup | 中 | 保留 |
| `mcp.tool-timeout-seconds` | `application.yml:70` | `MCPManager.java:42,148` | 工具调用超时 | DEPLOY_ONLY | startup | 中（另有硬编码 30/60s 旁路，见 M13） | 保留 |

> **注意：** 本分支**没有** CSRF 或 Same-Origin 过滤器。`CorsConfig` 只约束跨域读写，不构成 CSRF 防护；PRD §2.2 所说「既有 CSRF/Origin 安全检查」在本分支不成立。多 Agent 分支 `6ba65478` 新增了 `config/SameOriginFilter.java`（`security.same-origin.additional-hosts`），但未合并。

### 2.3 外部服务与推理指纹

| configKey | sourceFile | consumer | purpose | classification | lifecycle | risk | migrationDecision |
|---|---|---|---|---|---|---|---|
| `cos.client.host` / `region` / `bucket` | `application-server.example.yml:57-61` | `config/CosClientConfig.java`、`manager/CosManager.java`、`manager/FileManager.java:83` | 对象存储 | DEPLOY_ONLY | startup | 高 | 保留 |
| `cos.client.secretId` / `secretKey` | `application-server.example.yml:58-59` | `CosClientConfig.java:33,38,53` | 凭据 | SECRET_REF | startup | **高** | 保留（只登记引用） |
| `diagnosis.grpc.host` / `port` | `application-server.example.yml:63-67` | `config/GrpcConfig.java:11-13`、`grpc/DiagnosisGrpcClient.java:29` | 算法服务端点 | DEPLOY_ONLY | startup | 高 | 保留 |
| `diagnosis.grpc.deadline-ms` | `application-server.example.yml:67` | `DiagnosisGrpcClient.java:42` | 每次调用超时（默认 10000） | DYNAMIC | per-request | 低 | 后续重构 |
| `eye-diagnosis.inference.model-version` | `application.yml:93` | `service/impl/DiagnosisServiceImpl.java:85,236-258` | 缓存指纹 | STATIC_POLICY | startup | **高**（动态改会污染缓存） | 保留 |
| `eye-diagnosis.inference.preprocess-version` | `application.yml:95` | 同上 | 缓存指纹 | STATIC_POLICY | startup | 高 | 保留 |
| `eye-diagnosis.inference.model-weight-sha256` | `application.yml:94` | `DiagnosisServiceImpl.java:91,235` | 缓存指纹 | STATIC_POLICY | startup | 高 | 保留 |
| `eye-diagnosis.inference.policy-version` | `application.yml:96` | `DiagnosisServiceImpl.java:94,236-258` | 缓存指纹 | STATIC_POLICY | startup | 高 | 保留 |
| `eye-diagnosis.inference.hash-algorithm` | `application.yml:92` | **无 Java 消费者**（代码硬编码 `SHA-256`：`DiagnosisServiceImpl.java:394`、`DocumentProcessingService.java:47`） | — | — | — | 低 | 后续重构（删除或真正读取） |

### 2.4 AI 与 RAG

| configKey | sourceFile | consumer | purpose | classification | lifecycle | risk | migrationDecision |
|---|---|---|---|---|---|---|---|
| `spring.ai.openai.base-url` / `api-key` / `chat.options.model` / `temperature` | `application-server.example.yml:36-42` | Spring AI 自动配置 | Chat 主模型（`qwen3.5-plus`） | DEPLOY_ONLY / SECRET_REF | startup | **高** | 保留（第一期不动态） |
| `spring.ai.dashscope.api-key` / `embedding.enabled` / `embedding.options.model` | `application-server.example.yml:43-48` | Spring AI 自动配置 | Embedding（`text-embedding-v3`） | DEPLOY_ONLY / SECRET_REF | startup | 高 | 保留 |
| `spring.ai.rerank.options.model` / `top-n` / `return-documents` | `application-server.example.yml:49-53` | Spring AI 自动配置 | Rerank（`gte-rerank-v2`） | STATIC_POLICY | startup | 中 | 保留 |
| `eye-diagnosis.vision-recognition.base-url` | `application.yml:98` | `agent/tools/EyeImageAnalyzerTool.java:33,60` | 视觉模型端点 | DEPLOY_ONLY | startup | 高 | 保留 |
| `eye-diagnosis.vision-recognition.api-key` | `application.yml:99` | `EyeImageAnalyzerTool.java:36,60` | 视觉模型凭据 | SECRET_REF | startup | **高**（tracked yml 里是占位字面量，见 M12） | 保留 |
| `eye-diagnosis.vision-recognition.model` | `application.yml:100` | `EyeImageAnalyzerTool.java:39,62` | `qwen-vl-plus` | DEPLOY_ONLY | startup | 高 | 保留 |
| `spring.ai.vectorstore.chroma.client.host` / `port` | `application-server.example.yml:31-32` | `agent/config/VectorStoreConfig.java:17,20,33` | Chroma 端点 | DEPLOY_ONLY | startup | 高 | 保留 |
| `spring.ai.vectorstore.chroma.collection-name` | `application-server.example.yml:35` | `VectorStoreConfig.java:23,43` | 集合名 | DEPLOY_ONLY | startup | 中（与代码默认不同，见 M1） | 保留 |
| `spring.ai.vectorstore.chroma.tenant-name` / `database-name` | `application-server.example.yml:33-34` | **无消费者**（`VectorStoreConfig.java:41-42` 硬编码） | — | — | — | 低 | 后续重构 |
| `eye-diagnosis.rag.chunk-size` / `chunk-overlap` | `application.yml:102-103` | `agent/rag/TextChunkerService.java:16,19` | 切分粒度 | DYNAMIC | startup | 中（只影响新入库） | 后续重构 |
| `eye-diagnosis.rag.search.top-k` / `final-top-k` / `similarity-threshold` | `application.yml:110-112` | `agent/tools/DocumentSearchTool.java:26,29,32` | 检索参数 | DYNAMIC | startup | 中 | 后续重构 |
| `eye-diagnosis.rag.rerank.enabled` | `application.yml:114` | `DocumentSearchTool.java:35` | Rerank 开关 | STATIC_POLICY | startup | 中 | 保留 |
| `eye-diagnosis.rag.hybrid-search.enabled` | `application.yml:117` | `DocumentSearchTool.java:38` | 混合检索开关 | STATIC_POLICY | startup | **高**（代码默认 `false` 与 yml `true` 相反，见 M10） | 保留 |
| `eye-diagnosis.rag.hybrid-search.rrf-k` | `application.yml:118` | `DocumentSearchTool.java:41,269` | RRF 常数 | DYNAMIC | startup | 低 | 后续重构 |
| `eye-diagnosis.rag.corpus.seed-enabled` / `resource-pattern` | `application.yml:106-108` | `agent/rag/BuiltinCorpusSeeder.java:40,44,52` | 启动播种（产生嵌入费用） | STATIC_POLICY / DEPLOY_ONLY | startup | 高 | 保留 |
| `eye-diagnosis.rag.evaluation.enabled` | `application.yml:119-120` | **无消费者**（测试由 `RUN_RAG_EVALUATION_TESTS` 环境变量控制） | — | — | — | 低 | 后续重构 |

### 2.5 Agent 运行参数

| configKey | sourceFile | consumer | purpose | classification | lifecycle | risk | migrationDecision |
|---|---|---|---|---|---|---|---|
| `agent.max-history-page-size`（默认 100） | **无 yml** | `controller/AgentController.java:106` | 历史分页上限 | DYNAMIC | per-request | 低 | 后续重构 |
| `agent.history-truncate-length` / `-reserve` | **无 yml** | `agent/service/ChatMessageWriter.java:99-100` | 消息截断 | DYNAMIC | per-request | 低 | 后续重构 |
| `agent.max-iterations` / `agent.model-call-limit` | **无 yml** | **无消费者**（只绑定在 `agent/config/AgentConstants.java:12-13`；`DiagnosisAgent.java:85` 注入后未使用） | — | — | — | 低（死配置） | 后续重构（删除） |
| `agent.queue.parallelism`（默认 8） | **无 yml** | `agent/queue/AgentQueueConfig.java:12` | 会话队列并行度 | DEPLOY_ONLY | startup | 中 | 保留 |
| `document.executor.core-size` / `max-size` / `queue-capacity` | **无 yml** | `config/AsyncConfig.java:28-34` | 文档 ETL 线程池 | DEPLOY_ONLY | startup | 中 | 保留 |
| `eye-diagnosis.upload.compensation.enabled` | `application.yml:84-86` | `upload/state/UploadCompensationScheduler.java:18` | 破坏性对账开关 | STATIC_POLICY | startup | **高**（会真实删 COS 对象） | 保留 |
| `eye-diagnosis.upload.compensation.interval-ms` / `initial-delay-ms` / `min-age-minutes` | `application.yml:87-90` | `UploadCompensationScheduler.java:24-25`、`UploadCompensationService.java:48,120` | 对账节奏与宽限期 | DYNAMIC | startup / scheduled | 中 | 后续重构 |

### 2.6 测试与本地验证（per-test-run，不入产品配置）

| configKey | sourceFile | consumer | classification |
|---|---|---|---|
| `FLYWAY_TEST_URL` / `USERNAME` / `PASSWORD` / `SCHEMA` | `scripts/verify.sh:85-88` | `migration/FlywayMySqlIntegrationTest.java:22-28`、`upload/state/UploadTaskMapperMySqlIntegrationTest.java:48-63` | DEPLOY_ONLY / SECRET_REF |
| `SPRING_PROFILES_ACTIVE=ci`、`SPRING_DATASOURCE_*`、`SPRING_DATA_REDIS_*`、`SPRING_FLYWAY_SCHEMAS` | `scripts/verify.sh:69-75`、`verify.yml:110-111` | Spring Boot | DEPLOY_ONLY |
| `RUN_RAG_EVALUATION_TESTS` | 测试进程环境 | `agent/rag/RAGEvaluationTest.java:18` | DEPLOY_ONLY |
| `RUN_CHROMA_INTEGRATION_TESTS` | 测试进程环境 | `agent/config/VectorStoreConfigTest.java:16` | DEPLOY_ONLY |

---

## 3. Python 算法服务（运行时）

> 离线训练/评估（`algorithm/p1/`、`train_model.py`、`evaluate_model.py`、`frozen_eval.py` 的 CLI 参数）不在动态配置候选内，只登记入口。

| configKey | sourceFile | consumer | purpose | classification | lifecycle | risk | migrationDecision |
|---|---|---|---|---|---|---|---|
| `MODEL_WEIGHTS_PATH` | `algorithm/grpc_server.py:36` | `_resolve_weights_path` → `DiagnosisServicer.__init__` `:60` | 权重文件 | DEPLOY_ONLY | startup | **高**（必填，无默认） | 保留 |
| `MODEL_WEIGHTS_SHA256` | `algorithm/grpc_server.py:49` | `_verify_sha256` `:50` | 权重完整性 | STATIC_POLICY | startup | 高（代码允许不设，README 称必填） | 保留 |
| `MODEL_REGISTRY_PATH` | `algorithm/grpc_server.py:62-65` | `eye_diagnosis/registry.py:24-39` | 版本 + SHA 白名单 | DEPLOY_ONLY | startup | **高**（默认 `checkpoints/registry.json` 的 `allow_sha256` 为空，未覆盖则拒绝一切权重） | 保留 |
| `MODEL_CALIBRATION_PATH` | `algorithm/grpc_server.py:67-70` | `eye_diagnosis/calibration.py:33` | 温度校准 | DEPLOY_ONLY | startup | 中（默认 `NOT_CALIBRATED`, T=1.0） | 保留 |
| `INFERENCE_POLICY_VERSION` | `algorithm/grpc_server.py:78` | `:78,156` | 证据标签 | STATIC_POLICY | startup | 中（README 仍写 v2） | 保留 |
| `QUALITY_GATE_MODE` | `algorithm/grpc_server.py:81` | `eye_diagnosis/abstain.py:34-38` | 质量门 `observe`/`enforce` | STATIC_POLICY | startup | **高**（默认 observe 不拒识） | 保留 |
| gRPC 监听 `0.0.0.0:50051` | `algorithm/grpc_server.py:176` | `serve()` | 绑定地址 | DEPLOY_ONLY | startup | **高**（明文、无鉴权、全接口） | 保留（建议后续环境变量化） |
| gRPC `max_workers=4` | `algorithm/grpc_server.py:172` | `serve()` | 并发 | STATIC_POLICY | startup | 中 | 保留 |
| gRPC 消息大小上限 | **未配置**（`grpc_server.py:169-179`） | — | 默认 4MB | STATIC_POLICY | startup | **高**（Java 侧 multipart 允许 10MB） | 后续重构 |
| `MCP_HOST` / `MCP_PORT` | `algorithm/mcp_server/config.py:35-36` | `server.py:48` | MCP 绑定（默认 `0.0.0.0:8000`） | DEPLOY_ONLY | startup | **高**（8000 与 ChromaDB 端口冲突） | 保留 |
| `MODEL_PATH` / `MODEL_ARCH` / `NUM_CLASSES` / `DEVICE` / `LOG_LEVEL` | `algorithm/mcp_server/config.py:37-41` | `tools.py:27-38` | MCP 侧模型加载 | DEPLOY_ONLY / STATIC_POLICY | startup | 高 | 保留 |
| 质量阈值（blur<12、亮度/对比度/覆盖率） | `algorithm/eye_diagnosis/quality.py:52-59` | `evaluate_quality` `:40-71` | 图像质量门 | STATIC_POLICY | per-request | **高** | 保留（医学口径，不入配置中心） |
| 拒识阈值（0.7 / margin 0.15） | `algorithm/eye_diagnosis/abstain.py:30,53` | `decide_abstain` `:41-55` | 复核判定 | STATIC_POLICY | per-request | **高** | 保留 |
| OOD（硬编码关闭） | `algorithm/grpc_server.py:118-120` | `Diagnose` `:88-166` | 分布外门 | STATIC_POLICY | per-request | **高** | 保留（启用需单独评审） |
| 8 类类别顺序 | `algorithm/eye_disease_model.py:18-27` | `grpc_server.py:115,141` | 标签映射 | STATIC_POLICY | import-time | **高**（与 P1 `CLASS_ORDER` 不同） | 保留（冻结契约） |
| MCP 图像 URL 抓取（30s / 50MB / 100MB base64） | `algorithm/mcp_server/image_handler.py:50,55,67` | `resolve_image` `:21-75` | 远程取图 | STATIC_POLICY | per-request | 中（无 URL 白名单） | 保留 |

**冻结、禁止动态化的算法契约**（改动需单独审批）：`algorithm/p1/protocol_e0_e3_v1.json`、`algorithm/p1/protocol_p2_02a_v1.json`、`algorithm/p1/split.py`、`algorithm/p1/manifest.py`、`algorithm/checkpoints/registry.json`、`algorithm/configs/calibration/*.json`、`src/main/proto/diagnosis.proto`。

---

## 4. React 产品前端（`web/`）

| configKey / 资产 | sourceFile | consumer | purpose | classification | lifecycle | risk | migrationDecision |
|---|---|---|---|---|---|---|---|
| `VITE_API_BASE_URL`（默认 `/api`） | `web/src/lib/http.ts:16` | `request()` `:57`、SSE `web/src/lib/api.ts:390`、`adminApi.ts:242-244` | API 基址 | DEPLOY_ONLY | build-time | 中 | 保留 |
| Vite dev proxy `/api` → `http://localhost:8081` + Origin 改写 | `web/vite.config.ts:25-32` | 开发服务器 | 本地联调 | DEPLOY_ONLY | dev-only | 低 | 保留 |
| dev server 端口 `5173` | `web/vite.config.ts:22` | Vite | 本地端口 | STATIC_POLICY | dev-only | 低 | 保留 |
| 文档标题 `Iris · 眼底影像判读` | `web/index.html:18` | 浏览器标签（所有路由） | 站点标题 | **DYNAMIC 候选** | build-time（静态 HTML） | 中 | **纳入 MVP（brand.siteName）** |
| Favicon `/brand/iris-favicon.ico` | `web/index.html:6` | 浏览器标签 | 图标 | **DYNAMIC 候选** | build-time | 中 | **纳入 MVP（brand.favicon.*）** |
| Apple touch icon `/brand/iris-app-tile-180.png` | `web/index.html:7` | 主屏图标 | 图标 | DYNAMIC 候选 | build-time | 低 | 纳入 MVP |
| 品牌标 light/dark 位图 | `web/src/components/shell/Wordmark.tsx:19-29` | 全站铭牌（顶栏/页脚/认证页） | Logo | **DYNAMIC 候选** | runtime（CSS 切换） | 中 | **纳入 MVP（brand.logo.*）** |
| 管理端单色标 | `web/src/components/admin/AdminNav.tsx:42-65` | 管理端侧栏 | Logo | DYNAMIC 候选 | runtime | 中 | 纳入 MVP |
| Agent 欢迎页品牌标 | `web/src/components/agent/WelcomeScreen.tsx:63-73` | Intelligence 场景 | Logo | DYNAMIC 候选 | runtime | 低 | 纳入 MVP |
| `theme-color` 双值 `#f2f6fc` / `#0b1425` | `web/index.html:13,30-31`；`theme-provider.tsx:79-86` | 移动端浏览器 chrome | 品牌色 | STATIC_POLICY（设计令牌） | runtime | 中 | 保留（不属于品牌资源） |
| 品牌名 `Iris`（侧栏副标 `MEDICAL SAAS`） | `AdminNav.tsx:73-84` | 管理端侧栏 | 站点名 | DYNAMIC 候选 | runtime | 低 | 纳入 MVP（brand.shortName） |
| 医学免责声明与「示例影像」文案 | `DisclaimerBar.tsx:18`、`SiteFooter.tsx:60-69`、`BrandFooter.tsx:93-104`、`AuthShell.tsx:91-93`、`LandingPage.tsx:611-618` | 全站 | 法律/医学边界 | **STATIC_POLICY（禁止可配置）** | build-time | **高** | 保留 |
| `E2E_*` / `CI` / `PLAYWRIGHT_BROWSERS_PATH` | `web/playwright.config.ts:24-42,74` | Playwright | 测试 | DEPLOY_ONLY | per-test-run | 低 | 保留 |

---

## 5. 部署与 CI

| 项 | 位置 | 事实 |
|---|---|---|
| ChromaDB | `docker-compose.yml:3-10` | 镜像 `chroma:1.0.0`，宿主端口 **8000**，持久卷 `chroma-data` |
| 本地后端验证 | `scripts/verify.sh:19-24,44-49,69-75` | MySQL `8.0.26`@33306、Redis@36379、schema `diagnosis_ci`、profile `ci`、JDK 路径硬编码 |
| CI Python | `.github/workflows/verify.yml:9-31` | Python 3.11，`frozen_eval` 冒烟 + pytest（`not slow`） |
| CI Backend | `.github/workflows/verify.yml:80-120` | MySQL 8.0、Redis 7、Chroma 1.0.0、`SPRING_PROFILES_ACTIVE=ci` |
| CI Flyway | `.github/workflows/verify.yml:122-151` | 两个 MySQL 集成门禁，`FLYWAY_TEST_*` |
| CI Frontend/Web | `.github/workflows/verify.yml:153-193` | Vue 线 `npm run lint:check/test/build`；React 线 `typecheck/test/build/lint` + 两个门禁脚本 |
| 仓库内无部署件 | `git ls-files` | 无 Dockerfile、systemd unit、nginx conf；生产部署形态在本仓库之外 |

---

## 6. 多重事实来源与缺口

### Java（15 条）

| # | 缺口 | 证据 | 处置建议 |
|---|---|---|---|
| M1 | Chroma collection 名三处不一致 | 代码默认 `eye-diagnosis-knowledge`（`VectorStoreConfig.java:23`）、server 示例 `diagnosis-knowledge`（`application-server.example.yml:35`）、`application.yml` 未定义 | 统一为唯一键 + 唯一默认值 |
| M2 | `tenant-name` / `database-name` 是死 yml | yml 有键，代码硬编码（`VectorStoreConfig.java:41-42`） | 删除 yml 或真正读取 |
| M3 | `hash-algorithm` 是死 yml | 代码硬编码 `SHA-256`（`DiagnosisServiceImpl.java:394`、`DocumentProcessingService.java:47`） | 删除键 |
| M4 | `rag.evaluation.enabled` 无消费者 | 实际由 `RUN_RAG_EVALUATION_TESTS` 控制 | 删除键 |
| M5 | `agent.max-iterations` / `model-call-limit` 死配置 | `AgentConstants.java:12-13` 无人读 | 删除或接线 |
| M6 | `agent.*`、`agent.queue.parallelism`、`document.executor.*` 无 yml | 只有代码默认值 | 补 yml（便于运维可见） |
| M7 | Chroma 三键在 `application.yml` 缺失 | 只有 server 示例有 | 补默认值 |
| M8 | COS / gRPC 键在 `application.yml` 缺失 | 只有 server 示例与 CI 有 | 明确「必须由 profile 提供」 |
| M9 | 上传上限冲突 | 框架 10MB（`application.yml:14`） vs 代码 2MB（`FileManager.java:102`、`AgentImageUploadService.java:44`） | 统一口径 |
| M10 | 混合检索默认值相反 | 代码 `false`（`DocumentSearchTool.java:38`） vs yml `true`（`application.yml:117`） | 以 yml 为唯一真源 |
| M11 | `policy-version` 默认值不同 | 代码空 vs yml `${INFERENCE_POLICY_VERSION:medical-safety-v3-quality-observe}` | 统一 |
| M12 | tracked yml 含凭据占位字面量 | `application.yml:99`（值不复制） | 改为 `${DASHSCOPE_API_KEY}` |
| M13 | MCP 超时绕过配置 | `MCPManager.java:73-74,86-87,104` 硬编码 30/60s | 接线到配置 |
| M14 | 关键 TTL/上限硬编码 | 工具缓存 5min（`MCPManager.java:30`）、文档缓存 60s（`DocumentSearchTool.java:53`）、`topK(1000)`、`maxKeys(1000)` 等 | 登记为 STATIC_POLICY，暂不动态 |
| M15 | 本地 profile 不可复核 | `spring.profiles.active: local,dev`，但两文件未入库且不在本工作树 | 由 `CLAUDE.local.md` 与部署文档承担 |

### Python（6 条）

| # | 缺口 | 证据 |
|---|---|---|
| P1 | 默认 registry 白名单为空，未覆盖即拒绝一切权重 | `algorithm/checkpoints/registry.json:5` |
| P2 | `MODEL_WEIGHTS_SHA256` 代码可选、README 称必填 | `grpc_server.py:49` vs `README.md:108` |
| P3 | MCP 默认端口 8000 与 ChromaDB 冲突 | `mcp_server/config.py:36` vs `docker-compose.yml:5-6` |
| P4 | 两套类别顺序（运行时 vs P1 训练） | `eye_disease_model.py:18-27` vs `p1/audit.py:51-62` |
| P5 | 无 gRPC 消息大小上限，与 Java 10MB 上传不匹配 | `grpc_server.py:169-179` |
| P6 | 安全门实际偏软：OOD 硬编码关闭、质量门默认 `observe`、校准 `NOT_CALIBRATED` | `grpc_server.py:118-120,81`；`configs/calibration/efficientnet_b4_temperature.json` |

### 前端（1 条）

| # | 缺口 | 证据 |
|---|---|---|
| W1 | 品牌元素全部是构建期静态值，无运行时注入点 | `web/index.html:6,18`、`Wordmark.tsx:19-29`、`AdminNav.tsx:47-57` |

---

## 7. 纳入 MVP 的配置项（第一批，仅品牌）

按 PRD FR-04/FR-05，第一期只登记以下 6 个键；其余全部**不进入**动态管理：

| key | type | default | 读取位置 |
|---|---|---|---|
| `brand.siteName` | STRING | `Iris` | `web/index.html` title、`AdminNav` 品牌名 |
| `brand.shortName` | STRING | `Iris` | 导航/页脚短名 |
| `brand.logo.light` | ASSET_REF | 内置 `iris-optical-light-*` | `Wordmark.tsx` |
| `brand.logo.dark` | ASSET_REF | 内置 `iris-optical-dark-*` | `Wordmark.tsx` |
| `brand.favicon.light` | ASSET_REF | 内置 `iris-favicon.ico` | `web/index.html` |
| `brand.favicon.dark` | ASSET_REF | 内置 `iris-favicon.ico`（当前无暗色变体） | 需新增运行时 `<link>` 改写 |

> 注：FR-04 的默认值表把 `logo.light`/`logo.dark` 都写成「内置浅色/深色品牌资源」，与现有 `iris-optical-light/dark` 一一对应；favicon 目前**没有**双主题资源，`brand.favicon.dark` 的默认值只能先指向同一文件。

---

## 7.1 后续确认（2026-11-16，定向修订）

- 配置中心第一期**不把任何既有键**从 yml/环境变量迁移为动态配置；`brand.*` 是新增键，默认值对应现有静态资源。
- Provider 连接元数据在现有代码里**没有配置来源**（没有 `t_provider_*` 表，也没有读取它的代码）；它属于新增数据模型，不改变本清单的任何一行。
- Flyway 版本号（暂定 V29）需在 WP-01 建表前重新核对目标集成分支，见 `phase0-review.md` P1-04。
- 本清单的代码事实不做「为统一文案而修改」的改写；后续若有新证据，追加而不是覆盖。

## 8. 未覆盖 / 需复核

1. **`application-local.yml` / `application-dev.yml` / `application-server.yml`** 不在工作树内，未审计其覆盖值；主检出目录中的 `application-local.yml` 含真实凭据（未入库）。
2. **多 Agent 分支 `6ba65478`** 未纳入本清单（与基线分叉 533 文件 / +68,725 行）。其新增配置（`agent.tool-audit.*`、`eye-diagnosis.collaboration.cursor-key`、`security.same-origin.additional-hosts`、`SameOriginFilter`）需在合并后补审。
3. **生产部署配置**（nginx、systemd、环境变量清单）不在仓库内，无法从代码证明线上实际取值。
4. `frontend/`（Vue，已弃用）的 `.env.production` 仍指向旧 IP，仅作历史记录，不构成现行配置源。

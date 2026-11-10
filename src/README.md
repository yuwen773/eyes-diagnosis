# Iris 后端 - 眼科智能诊断服务

Spring Boot 3.5.6 + Java 21 后端服务，提供 REST API、AI Agent 对话、图像诊断、知识库管理等能力。

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Spring Boot | 3.5.6 | Web 框架 |
| Spring AI | 1.1.2 | AI 模型集成 |
| Spring AI Alibaba | 1.1.2.2 | DashScope 模型适配 |
| MyBatis Plus | 3.5.12 | ORM（数据库操作） |
| gRPC | 1.71.0 | 与 Python 算法服务通信 |
| Protobuf | 4.30.2 | 接口定义与序列化 |
| Knife4j | 4.4.0 | API 文档（OpenAPI 3） |

## 包结构

```
src/main/java/com/csust/eyediagnosis/
├── agent/                  # AI Agent 核心
│   ├── DiagnosisAgent      # ReactAgent 封装，流式对话入口
│   ├── config/             # Agent 常量配置、ChromaDB 向量库配置
│   ├── interceptor/        # MCP 服务器解析拦截器
│   ├── manager/            # MCPManager（创建客户端、发现工具、调用工具）
│   ├── mcp/                # McpToolCallback（桥接 MCP 工具到 Spring AI）
│   ├── model/              # EyeAnalysisResult（视觉分析结构化输出）
│   ├── rag/                # DocumentParser + TextChunkerService（RAG 文档处理）
│   ├── service/            # ChatHistoryService、McpServerService
│   └── tools/              # EyeImageAnalyzerTool、DocumentSearchTool
├── annotation/             # @AuthCheck 自定义注解
├── aop/                    # AuthInterceptor（基于 AOP 的权限校验）
├── common/                 # BaseResponse<T>、PageRequest 等通用类
├── config/                 # Spring 配置（CORS、COS、gRPC、MyBatis、异步等）
├── constant/               # 常量与枚举（疾病分类、错误码等）
├── controller/             # 6 个 REST 控制器
├── exception/              # 全局异常处理（BusinessException、ErrorCode）
├── grpc/                   # DiagnosisGrpcClient（调用 Python 算法服务）
├── manager/                # CosManager、FileManager（腾讯云 COS 文件操作）
├── mapper/                 # MyBatis Plus Mapper 接口（7 个）
├── model/
│   ├── dto/                # 请求 DTO（按领域分组）
│   ├── entity/             # 数据库实体（10 个表）
│   ├── enums/              # UserRole 枚举
│   └── vo/                 # 响应 VO
├── service/                # 业务 Service 接口
│   └── impl/               # 业务 Service 实现
└── utils/                  # EncryptUtils、IdGenerator、JsonUtils
```

## 核心模块说明

### Agent 系统

基于 Spring AI Alibaba 的 `ReactAgent`，支持流式输出和工具调用。

- **DiagnosisAgent**：主 Agent，内置系统 Prompt 定义角色为眼科 AI 助手，流式返回 `Flux<MessageDTO>`（SSE 事件类型：ASSISTANT / REASONING / TOOL_REQUEST / TOOL_CONFIRM，终止事件 `done`）
- **EyeImageAnalyzerTool**：调用 DashScope `qwen-vl-plus` 视觉模型分析眼底图像，返回结构化结果（描述、异常、紧急程度、建议）
- **DocumentSearchTool**：对 ChromaDB 执行向量相似度搜索，返回 Top-5 相关文档片段

### MCP 集成

支持用户动态配置外部 MCP 工具服务器，扩展 Agent 能力。

- 传输协议：STDIO / SSE / Streamable HTTP
- 优先级：会话级覆盖 > 用户全局启用 > 禁用
- 工具列表缓存于 Redis（5 分钟 TTL）

### RAG 知识库

文档处理流水线：上传 → DocumentParser 解析（PDF/MD/DOCX/TXT）→ TextChunkerService 分块（512 词，64 词重叠）→ DashScope 嵌入 → ChromaDB 存储。

**内置语料播种**：`src/main/resources/rag/*.md` 里的眼科基础知识由 `BuiltinCorpusSeeder` 在启动时切分并写入 ChromaDB，打上 `ownerUserId = 0` 的公共标记。检索过滤为 `ownerUserId == 当前用户 || ownerUserId == 0`，因此内置语料对所有用户可见，用户私有文档仍然隔离。播种需要调用嵌入模型（产生费用），默认关闭：

```bash
mvn spring-boot:run -Dspring-boot.run.arguments=--eye-diagnosis.rag.corpus.seed-enabled=true
```

### 上传补偿

Agent 对话图片的 COS 对象与 `t_upload_task` 任务行是两次独立写入，进程在"对象写成功、任务行未落库"之间崩溃会留下孤儿对象。`UploadCompensationScheduler` 周期性地按 owner 前缀对账，删除没有有效任务登记的孤儿对象；同时跳过仍在宽限期（`min-age-minutes`，默认 30 分钟）内被修改的对象，避免误删正在上传的图片。该任务会真实删除对象存储中的文件，默认关闭：

```yaml
eye-diagnosis:
  upload:
    compensation:
      enabled: true
      interval-ms: 3600000
      initial-delay-ms: 600000
      min-age-minutes: 30
```

### gRPC 诊断

通过 Protobuf 定义 `DiagnosisService`，Java 后端作为客户端调用 Python 算法服务进行图像分类。

## 认证与权限

- Spring Session + Redis 存储会话
- `@AuthCheck(mustRole = "admin")` / `@AuthCheck(mustRole = "user")` 注解控制接口权限
- 两种角色：`user`（普通用户）、`admin`（管理员）

## 配置文件

| 文件 | 说明 |
|------|------|
| `application.yml` | 主配置（端口 8081、上下文 /api、会话 30 天） |
| `application-dev.yml` | 开发环境（MySQL、Redis 连接） |
| `application-local.yml` | 本地密钥配置（gitignored，需自行创建） |
| `application-server.example.yml` | 服务器部署配置模板（复制为 `application-server.yml`） |
| `db/migration/V*.sql` | Flyway 迁移脚本（schema 权威来源，启动时自动执行） |
| `db/callback/*.sql` | Flyway 回调：新库所需的基线建表 |

## 构建与运行

```bash
# 构建（含 Protobuf 代码生成）
mvn clean package

# 启动开发服务
mvn spring-boot:run

# 运行单个测试
mvn test -Dtest=ClassName#method
```

启动后 API 地址：`http://localhost:8081/api`
API 文档：`http://localhost:8081/api/swagger-ui.html`

## 外部服务依赖

| 服务 | 用途 | 默认地址 |
|------|------|----------|
| MySQL | 主数据库 | localhost:3306/diagnosis |
| Redis | 会话存储 + 缓存 | localhost:6379 |
| ChromaDB | 向量数据库（RAG） | localhost:8000 |
| DashScope | LLM + 嵌入 + 视觉模型 | 阿里云 API |
| 腾讯云 COS | 文件/图片存储 | 云端 |
| Python gRPC | 图像分类算法 | 127.0.0.1:50051 |

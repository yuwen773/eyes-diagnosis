# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Eye Diagnosis AI System — **Spring Boot 3.5.6** (Java 21) + **Vue 3** frontend + **Python** algorithm service.
Base package: `com.csust.eyediagnosis`

> **本分支是 Java 线。** 仓库里另有一条 Python 后端线（FastAPI），在 `feature/python-backend`
> 分支，与本分支**不再互相合并**；`frontend/`、`algorithm/` 下的 ML 部分等共享目录各持一份，
> 改动需人工搬运。约定见 `docs/backend-split.md`。

## Navigation

- 领域命名、模块边界、易混术语 → `GLOSSARY.md`（架构评审与新增概念前读）。
- 找设计 / 计划 / 验收 / 迁移文档 → `docs/README.md`（按主题分组的索引）。
- 改数据库 → `src/main/resources/db/migration/V*.sql` 是迁移真源；版本编号与历史决策见 `docs/flyway-migration-history-plan.md`。
- 评审代码风格与判断类约定 → `CODING_STANDARDS.md`。

## Build & Verify

后端构建脚本看 `pom.xml`，前端脚本看 `frontend/package.json`，算法服务看 `algorithm/requirements.txt` 与 `run_mcp_server.py` / `grpc_server.py`；`docker-compose.yml` 起 ChromaDB :8000。

**后端全量验证走 `scripts/verify.sh`**：它自带一次性 MySQL 8 + Redis、注入 `SPRING_PROFILES_ACTIVE=ci`、跑完整 `mvn test`（含 `contextLoads` 与两个 MySQL 集成门禁），结束自动清理容器。JDK 21 由脚本设为 `C:\Users\yuwen\.jdks\corretto-21.0.7`；手工跑 Maven 时用 `JAVA_HOME=<该路径> mvn ...`。

Java 21 与本机 MySQL 实例的环境事实见主检出目录的 `CLAUDE.local.md`（不入库，工作树不自动继承）；Codex 侧同一份在 `~/.codex/AGENTS.md`。

## Architecture

**Backend**: Controller → Service → Mapper (MyBatis Plus). `BaseResponse<T>{code:0, data, msg}` unified response. Auth: Spring Session + Redis, `@AuthCheck(mustRole=...)` AOP. MyBatis Plus `map-underscore-to-camel-case: false`.

**Agent System** (`agent/`): Core AI chatbot on Spring AI + Spring AI Alibaba.
- `DiagnosisAgent` — `ReactAgent` with streaming `Flux<MessageDTO>`, SSE endpoint `/api/agent/chat/stream`
- `tools/EyeImageAnalyzerTool` — DashScope Qwen-VL-Plus vision analysis (`@Tool`)
- `tools/DocumentSearchTool` — ChromaDB RAG retrieval (`@Tool`)
- `manager/MCPManager` — MCP client factory (STDIO/SSE/Streamable HTTP), tool discovery cached in Redis 5min
- `interceptor/TextMcpModelInterceptor` — MCP server resolution priority: session override → user enabled → disabled
- `rag/` — Document parsing + 512-word chunking → ChromaDB via DashScope embeddings

**gRPC + Python Algorithm** (`algorithm/`): EfficientNet-B4 model for 8-class eye disease classification. Protobuf in `src/main/proto/diagnosis.proto`, compiled by `protobuf-maven-plugin` (Java) and `algorithm/generate_proto.py` (Python). Java client: `grpc/DiagnosisGrpcClient`.

**Frontend** (`frontend/`): Vue 3 + TypeScript + Ant Design Vue 4 + Tailwind CSS v4 + Pinia + ECharts. API clients generated via `@umijs/openapi`. Agent chat uses `@microsoft/fetch-event-source` for SSE.

## API Endpoints

| Controller | Path | Purpose |
|------------|------|---------|
| UserController | `/api/user/*` | Auth, CRUD |
| DiagnosisController | `/api/diagnosis/*` | Upload image, gRPC diagnosis, page query |
| AgentController | `/api/agent/*` | SSE chat stream, session/history |
| McpServerController | `/api/mcp/*` | MCP server CRUD |
| KnowledgeBaseController | `/api/knowledge/*` | RAG document management |
| NewsController | `/api/news/*` | News CRUD |

## Database (MySQL `diagnosis`)

Schema: `src/main/resources/db/migration/V*.sql` (Flyway migrations — authoritative; `db/callback/` bootstraps fresh installs). Never edit an applied migration; add a new one. Key tables: `t_user`, `t_diagnosis`, `t_agent_session`, `t_agent_message`, `t_mcp_server`, `t_knowledge_document`, `t_news`.

**命名规范**: 数据库列名统一使用**小驼峰**命名（如 `userId`, `fileName`, `isDelete`），与 Java 实体类字段保持一致。MyBatis Plus 配置 `map-underscore-to-camel-case: false`，不会自动转换下划线。

## External Services

MySQL | Redis (session + cache) | ChromaDB (vector RAG) | DashScope (LLM + embeddings + vision) | Tencent COS (file storage) | Python gRPC (image classification)

## Key Patterns

- **Agent streaming**: `DiagnosisAgent.stream()` → SSE events (ASSISTANT/REASONING/TOOL_REQUEST/TOOL_CONFIRM), terminal `event: "done"`
- **MCP integration**: User config → `MCPManager` creates client → discover tools → inject as `ToolCallback[]` into ReactAgent
- **RAG pipeline**: Upload → `DocumentParser` → `TextChunkerService` → ChromaDB → `DocumentSearchTool` retrieval
- **Protobuf codegen**: `src/main/proto/diagnosis.proto` → `protobuf-maven-plugin` → generated Java stubs; Python bindings via `algorithm/generate_proto.py`
- **Frontend API**: `npm run openapi` generates `src/api/*Controller.ts` from backend OpenAPI spec

## Design Context

写 `frontend/` 页面、组件、样式，或评审前端 diff 前 → 读 `docs/design-system.md`（品牌令牌、双主题、页面骨架、参考实现）。后端任务不需要读。

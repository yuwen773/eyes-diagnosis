# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Eye Diagnosis AI System — **Spring Boot 3.5.6** (Java 21) + **Vue 3** frontend + **Python** algorithm service.
Base package: `com.csust.eyediagnosis`

## Build & Run

```bash
# Backend
mvn clean package                    # Build (includes protobuf codegen)
mvn spring-boot:run                  # Dev server :8081, context-path /api
mvn test -Dtest=ClassName#method     # Run single test

# Frontend (in frontend/)
npm run dev                          # Dev server :5173
npm run build                        # Type-check + build
npm run openapi                      # Generate API client from OpenAPI spec

# Algorithm (in algorithm/)
pip install -r requirements.txt
python run_mcp_server.py             # MCP diagnosis server (Streamable HTTP)
python grpc_server.py                # gRPC server :50051

docker-compose up -d                 # ChromaDB vector store :8000
```

## Architecture

**Backend**: Controller → Service → Mapper (MyBatis Plus). `BaseResponse<T>{code:0, data, msg}` unified response. Auth: Spring Session + Redis, `@AuthCheck(mustRole=...)` AOP. MyBatis Plus `map-underscore-to-camel-case: false`.

**Agent System** (`agent/`): Core AI chatbot on Spring AI + Spring AI Alibaba.
- `DiagnosisAgent` — `ReactAgent` with streaming `Flux<MessageDTO>`, SSE endpoint `/api/agent/chat/stream`
- `tools/EyeImageAnalyzerTool` — DashScope Qwen-VL-Plus vision analysis (`@Tool`)
- `tools/DocumentSearchTool` — ChromaDB RAG retrieval (`@Tool`)
- `manager/MCPManager` — MCP client factory (STDIO/SSE/Streamable HTTP), tool discovery cached in Redis 5min
- `interceptor/TextMcpModelInterceptor` — MCP server resolution priority: session override → user enabled → disabled
- `rag/` — Document parsing + 512-word chunking → ChromaDB via DashScope embeddings

**gRPC + Python Algorithm** (`algorithm/`): EfficientNet-B4 model for 8-class eye disease classification. Protobuf in `diagnosis.proto`, compiled by `protobuf-maven-plugin`. Java client: `grpc/DiagnosisGrpcClient`.

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

Schema: `src/main/resources/db/schema.sql`. Key tables: `t_user`, `t_diagnosis`, `t_agent_session`, `t_agent_message`, `t_mcp_server`, `t_knowledge_document`, `t_news`.

## External Services

MySQL | Redis (session + cache) | ChromaDB (vector RAG) | DashScope (LLM + embeddings + vision) | Tencent COS (file storage) | Python gRPC (image classification)

## Key Patterns

- **Agent streaming**: `DiagnosisAgent.stream()` → SSE events (ASSISTANT/REASONING/TOOL_REQUEST/TOOL_CONFIRM), terminal `event: "done"`
- **MCP integration**: User config → `MCPManager` creates client → discover tools → inject as `ToolCallback[]` into ReactAgent
- **RAG pipeline**: Upload → `DocumentParser` → `TextChunkerService` → ChromaDB → `DocumentSearchTool` retrieval
- **Protobuf codegen**: `algorithm/diagnosis.proto` → `protobuf-maven-plugin` → generated Java stubs
- **Frontend API**: `npm run openapi` generates `src/api/*Controller.ts` from backend OpenAPI spec

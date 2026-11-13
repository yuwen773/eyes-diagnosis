# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Eye Diagnosis AI System — **Spring Boot 3.5.6** (Java 21) + **React 19** product frontend (`web/`) + **Python** algorithm service. `frontend/` is the historical Vue frontend; realtime collaboration work belongs in `web/`.
Base package: `com.csust.eyediagnosis`

> **本分支是 Java 线。** 仓库里另有一条 Python 后端线（FastAPI），在 `feature/python-backend`
> 分支，与本分支**不再互相合并**；`frontend/`、`algorithm/` 下的 ML 部分等共享目录各持一份，
> 改动需人工搬运。约定见 `docs/backend-split.md`。

诊断工作流的业务术语与授权边界（聊天会话 / 诊断工作流 / 正式记录、医生复核 / 患者保存授权）以 `CONTEXT.md` 为准：涉及这些概念或设计人工等待点时先读该文件。

Worktree-isolated sessions 只接受单条、无运行时计算的 Bash 命令；跨分支只读用 `git show <branch>:<path>`，详见 `AGENTS.md` 的 Worktree shell guard。JDK 21 用 `JAVA_HOME="/c/Users/yuwen/.jdks/corretto-21.0.7"`（MSYS 形式）。

派审查子代理前读 `docs/subagent-delegation.md`：明确完成判据、限定范围、等 harness 通知而非轮询；机械检查交给 `scripts/check_design_doc.py` 等脚本，子代理只判 judgement calls。

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

**Product frontend** (`web/`): React 19 + TypeScript + Vite. See `web/package.json` for typecheck, tests, build and lint. Ordinary chat and collaboration use `@microsoft/fetch-event-source`; their state and cancellation remain separate. TASK-04 collaboration is opt-in via `VITE_COLLABORATION_ENABLED=true`; see `docs/collaboration-client.md`.

**Historical frontend** (`frontend/`): Vue 3 + TypeScript + Ant Design Vue 4 + Tailwind CSS v4 + Pinia + ECharts. API clients generated via `@umijs/openapi`.

## API Endpoints

| Controller | Path | Purpose |
|------------|------|---------|
| UserController | `/api/user/*` | Auth, CRUD |
| DiagnosisController | `/api/diagnosis/*` | Upload image, gRPC diagnosis, page query |
| DiagnosisTaskController | `/api/diagnosis-tasks/*` | Patient image task: submit, idempotent replay, safe status (see `docs/diagnosis-task.md`) |
| AgentController | `/api/agent/*` | SSE chat stream, session/history |
| PatientDraftTestController / PatientDraftSeedController | `/api/patient-draft-test/*` | Opt-in admin-only draft validation |
| McpServerController | `/api/mcp-server/*` | MCP server CRUD |
| KnowledgeBaseController | `/api/knowledge/*` | RAG document management |
| NewsController | `/api/news/*` | News CRUD |
| ControlledReferenceController | `/api/controlled-references/*` | Controlled reference upload, governance, retrieval (see `docs/controlled-references.md`) |
| CollaborationRunController | `/api/agent/collaboration-runs/*` | Opt-in run admission, authorized snapshot/SSE and cancellation (see `docs/collaboration-runs.md`) |
| DoctorReviewController | `/api/doctor-reviews/*` | Assigned doctor review of frozen drafts (see `docs/doctor-review.md`) |

## Database (MySQL `diagnosis`)

Schema: `src/main/resources/db/migration/V*.sql` (Flyway migrations — authoritative; `db/callback/` bootstraps fresh installs). Never edit an applied migration; add a new one. Current head is V27. Key tables: `t_user`, `t_diagnosis`, `t_diagnosis_task`, `t_agent_session`, `t_agent_message`, `t_mcp_server`, `t_knowledge_document`, `t_news`, `t_controlled_reference`, `t_patient_draft_run`, `t_doctor_review`, `t_patient_authorization`.

**命名规范**: 数据库列名统一使用**小驼峰**命名（如 `userId`, `fileName`, `isDelete`），与 Java 实体类字段保持一致。MyBatis Plus 配置 `map-underscore-to-camel-case: false`，不会自动转换下划线。

## External Services

MySQL | Redis (session + cache) | ChromaDB (vector RAG) | DashScope (LLM + embeddings + vision) | Tencent COS (file storage) | Python gRPC (image classification)

## Key Patterns

- **Agent streaming**: `DiagnosisAgent.stream()` → SSE events (ASSISTANT/REASONING/TOOL_REQUEST/TOOL_CONFIRM), terminal `event: "done"`
- **MCP integration**: User config → `MCPManager` creates client → discover tools → inject as `ToolCallback[]` into ReactAgent
- **RAG pipeline**: Upload → `DocumentParser` → `TextChunkerService` → ChromaDB → `DocumentSearchTool` retrieval
- **Protobuf codegen**: `algorithm/diagnosis.proto` → `protobuf-maven-plugin` → generated Java stubs
- **Frontend API**: `npm run openapi` generates `src/api/*Controller.ts` from backend OpenAPI spec

## Design Context

产品前端设计真源是固定 React 基线引入的 `DESIGN.md`、`web/DESIGN.md` 和 `web/src/styles/tokens.css`。实时协作工作台沿用同一设计系统，按授权事实呈现状态和时间线。Vue 页面不作为实时协作交付或设计参考。

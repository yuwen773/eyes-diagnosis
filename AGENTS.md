# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Eye Diagnosis AI System — **Spring Boot 3.5.6** (Java 21) + **Vue 3** frontend + **Python** algorithm service.
Base package: `com.csust.eyediagnosis`

> **本分支是 Java 线。** 仓库里另有一条 Python 后端线（FastAPI），在 `feature/python-backend`
> 分支，与本分支**不再互相合并**；`frontend/`、`algorithm/` 下的 ML 部分等共享目录各持一份，
> 改动需人工搬运。约定见 `docs/backend-split.md`。

## MySQL

本机数据库连接信息属于环境事实，不入库：见 `src/main/resources/application-dev.yml`（已 gitignore）与本地 `CLAUDE.local.md` / `~/.codex/AGENTS.md`。

## Java 21 Runtime

Use the installed JDK 21 at `C:\Users\yuwen\.jdks\corretto-21.0.7` for all Maven and Java validation. Bash shell (Git Bash) must use MSYS-style paths — a `C:/...` `JAVA_HOME` breaks `PATH` parsing:

```bash
export JAVA_HOME="/c/Users/yuwen/.jdks/corretto-21.0.7"
export PATH="$JAVA_HOME/bin:$PATH"
```

## Worktree shell guard

Worktree-isolated sessions reject any Bash command whose text cannot be statically shown to stay inside this worktree. Commands refused include `docker ... SELECT ...`, `powershell`, `git -C <other-checkout>`, runtime-computed `sed`/`cd`, and commands whose name is a shell variable. Use one plain command per call with literal paths; for read-only checks of another branch use `git show <branch>:<path>` instead of `cd`.

Shell state does not persist between Bash tool calls, but the **primary working
directory does**: a `cd frontend` updates it for later calls, so subsequent
commands with relative paths resolve under `frontend/`. Prefer absolute paths
in tool arguments, or re-`cd` inside each invocation.

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
| DiagnosisTaskController | `/api/diagnosis-tasks/*` | Patient image task: submit, idempotent replay, safe status (see `docs/diagnosis-task.md`) |
| AgentController | `/api/agent/*` | SSE chat stream, session/history |
| McpServerController | `/api/mcp-server/*` | MCP server CRUD |
| KnowledgeBaseController | `/api/knowledge/*` | RAG document management |
| NewsController | `/api/news/*` | News CRUD |
| ControlledReferenceController | `/api/controlled-references/*` | Controlled reference upload, governance, retrieval (see `docs/controlled-references.md`) |
| DoctorReviewController | `/api/doctor-reviews/*` | Assigned doctor review of frozen drafts (see `docs/doctor-review.md`) |

## Database (MySQL `diagnosis`)

Schema: `src/main/resources/db/migration/V*.sql` (Flyway migrations — authoritative; `db/callback/` bootstraps fresh installs). Never edit an applied migration; add a new one. Current head is V13. Key tables: `t_user`, `t_diagnosis`, `t_diagnosis_task`, `t_agent_session`, `t_agent_message`, `t_mcp_server`, `t_knowledge_document`, `t_news`, `t_controlled_reference`, `t_patient_draft_run`, `t_doctor_review`.

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

前端视觉与交互规则的唯一真源是 `DESIGN.md`（含令牌值、字体、组件约定、Do/Don't 与 Agent 速查）。写 `.vue`、改样式、评审 UI 时读它。页面骨架用 sub-style B；已按 B 重写的三个页面是 `HomePage.vue`、`user/UserLoginPage.vue`、`user/UserRegisterPage.vue`，其余 17 页改到时以这三页为模板。

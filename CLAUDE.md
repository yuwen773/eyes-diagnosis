# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Iris — **Spring Boot 3.5.6** (Java 21) + **React 19** 产品前端（`web/`）+
**Vue 3** 已弃用前端（`frontend/`，deprecated）+ **Python** algorithm service.
Base package: `com.csust.eyediagnosis`

> **本分支是 Java 线。** 仓库里另有一条 Python 后端线（FastAPI），在 `feature/python-backend`
> 分支，与本分支**不再互相合并**；`frontend/`、`algorithm/` 下的 ML 部分等共享目录各持一份，
> 改动需人工搬运。约定见 `docs/backend-split.md`。

诊断工作流的业务术语与授权边界（聊天会话 / 诊断工作流 / 正式记录、医生复核 / 患者保存授权）以 `CONTEXT.md` 为准：涉及这些概念或设计人工等待点时先读该文件。

Worktree-isolated sessions 只接受单条、无运行时计算的 Bash 命令；跨分支只读用 `git show <branch>:<path>`，详见 `AGENTS.md` 的 Worktree shell guard。JDK 21 用 `JAVA_HOME="/c/Users/yuwen/.jdks/corretto-21.0.7"`（MSYS 形式）。

派审查子代理前读 `docs/subagent-delegation.md`：明确完成判据、限定范围、等 harness 通知而非轮询；机械检查交给 `scripts/check_design_doc.py` 等脚本，子代理只判 judgement calls。

## Navigation

- 领域命名、模块边界、易混术语 → `GLOSSARY.md`（架构评审与新增概念前读）。
- 找设计 / 计划 / 验收 / 迁移文档 → `docs/README.md`（按主题分组的索引）。
- 改数据库 → `src/main/resources/db/migration/V*.sql` 是迁移真源；版本编号与目标库升级路径见 `docs/architecture/migration-matrix.md`。
- 评审代码风格与判断类约定 → `CODING_STANDARDS.md`。
- 多工作树协作、Windows 进程操作、临时验证产物清理 → `docs/agent-worktree-conventions.md`。

## Build & Verify

后端构建脚本看 `pom.xml`，产品前端脚本看 `web/package.json`（`typecheck` / `test` / `build` / `lint`，
CI 里是根 `verify.yml` 的 `web` job），Vue 已弃用线看 `frontend/package.json`，算法服务看
`algorithm/requirements.txt` 与 `run_mcp_server.py` / `grpc_server.py`；`docker-compose.yml` 起 ChromaDB :8000。

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

**Frontend (product)** (`web/`): React 19 + TypeScript + Vite + Tailwind v4 + React Router. API 层手写于 `web/src/lib/api.ts`（统一 `ApiError` / `BaseResponse`），Agent 聊天用 `@microsoft/fetch-event-source` 消费 SSE。2026-11-10 起由 `git subtree` 纳入本仓库，原独立仓库 `eyes-diagnosis-web` 已归档。实时协作工作台沿用同一设计系统；TASK-04 collaboration is opt-in via `VITE_COLLABORATION_ENABLED=true`; see `docs/collaboration-client.md`.

**Frontend (deprecated)** (`frontend/`): Vue 3 + TypeScript + Ant Design Vue 4 + Tailwind CSS v4 + Pinia + ECharts. API clients generated via `@umijs/openapi`. **已弃用（deprecated，2026-11-10 起）**：不再开发、不再作为设计参考，仅保留可运行以作回溯；新功能与修复一律进 `web/`。

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

Schema: `src/main/resources/db/migration/V*.sql` (Flyway migrations — authoritative; `db/callback/` bootstraps fresh installs). Never edit an applied migration; add a new one. Current head is V27; upgrade paths per target database are in `docs/architecture/migration-matrix.md`. Key tables: `t_user`, `t_diagnosis`, `t_diagnosis_task`, `t_agent_session`, `t_agent_message`, `t_mcp_server`, `t_knowledge_document`, `t_news`, `t_controlled_reference`, `t_patient_draft_run`, `t_doctor_review`, `t_patient_authorization`.

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

设计真源是仓库根 `DESIGN.md`，令牌实现是 `web/src/styles/tokens.css`。实时协作工作台沿用同一设计系统，按授权事实呈现状态和时间线；Vue 页面不作为实时协作交付或设计参考。

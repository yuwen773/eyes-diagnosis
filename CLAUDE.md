# Current delivery (ticket 08, 2026-10-17)

Use the current Python instructions in [AGENTS.md](AGENTS.md),
[README.md](README.md) and [Python delivery](docs/python-delivery.md).
The entire retained text below is historical, including local contributor notes.
Its architecture, build commands and Java-retention constraints are superseded by
approved complete migration tickets 01–08; do not execute it as current guidance.

---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Python migration: session ticket 02 (2026-10-15)

Python owns `/api/user/login`, `/api/user/logout` and `/api/user/get/login`. Protected HTTP/SSE resolves `EYE_SESSION` through `eye:py:session:{sid}` in Redis and re-reads `t_user` on each request. Spring cookies grant no Python identity. No Java identity callback or `JAVA_BASE_URL` is needed. OpenAPI is `/api/openapi.json`; run `npm run openapi` against Python. Java assets remain until ticket 08; the Java architecture below is a retained reference. See [docs/python-session-auth-evidence.md](docs/python-session-auth-evidence.md).

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

# Python web layer (in algorithm/web/) -- the rewritten non-Agent domains
pip install -r requirements-web.txt  # no torch; the app boots without weights
uvicorn web.app:app --port 8080      # 34 endpoints, see docs/migration-decisions.md

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

**Python web layer** (`algorithm/web/`): a FastAPI rewrite of the five non-Agent domains — **34 endpoints** (user 11, diagnosis 8, news 7, knowledge 3, mcp-server 5). Runs on `:8080`, behind `deploy/nginx.conf` on `:8081`.

- The **Agent subsystem stays on Java, unchanged**. So do `POST /user/login`, `POST /user/logout` and `GET /user/get/login` — Spring Session's Redis payload is JDK-serialized and unreadable from Python, so Java owns the session and Python forwards `JSESSIONID` to it.
- **Inference is in-process** (`web/inference.py`), replacing the gRPC hop.
- **Chroma write side moved to Python, read side stayed on Java** — collection `diagnosis-knowledge`, tenant/database `default_tenant`/`default_database`, DashScope `text-embedding-v3`, `ownerUserId` metadata must be an **integer**, chunk ids `doc_{docId}_chunk_{i}`.
- **Three contracts are easy to break silently**: `Long` fields serialise as JSON **strings**, dates as `"yyyy-MM-dd HH:mm:ss"`, and every handled error is **HTTP 200** with a `code` in the body.
- **Before changing anything here**, read `docs/migration-decisions.md` (why each Java quirk is reproduced) and `docs/rewrite-findings.md` (defects found but deliberately *not* fixed — changing them changes production behaviour and needs a matching Java release).

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

**命名规范**: 数据库列名统一使用**小驼峰**命名（如 `userId`, `fileName`, `isDelete`），与 Java 实体类字段保持一致。MyBatis Plus 配置 `map-underscore-to-camel-case: false`，不会自动转换下划线。

## External Services

MySQL | Redis (session + cache) | ChromaDB (vector RAG) | DashScope (LLM + embeddings + vision) | Tencent COS (file storage) | Python gRPC (image classification)

## Key Patterns

- **Agent streaming**: `DiagnosisAgent.stream()` → SSE events (ASSISTANT/REASONING/TOOL_REQUEST/TOOL_CONFIRM), terminal `event: "done"`
- **MCP integration**: User config → `MCPManager` creates client → discover tools → inject as `ToolCallback[]` into ReactAgent
- **RAG pipeline**: Upload → `DocumentParser` → `TextChunkerService` → ChromaDB → `DocumentSearchTool` retrieval
- **Protobuf codegen**: `algorithm/diagnosis.proto` → `protobuf-maven-plugin` → generated Java stubs
- **Frontend API**: `npm run openapi` generates `src/api/*Controller.ts` from backend OpenAPI spec

## Verification

```bash
# Git Bash 里 mvn 会报 Launcher ClassNotFoundException，必须用 cmd //c
cmd //c "mvn -o -q compile -DskipTests"        # Java baseline, must stay exit 0
cd algorithm && python -m pytest web/tests -q  # 405 passed / 5 skipped
```

The Java tree is this rewrite's control group: `git status --porcelain -- src pom.xml`
must print nothing. If a Python-side change ever needs a Java edit to compile, the
"don't pollute the existing codebase" constraint has been broken.

Two things no unit test can cover, both in `docs/rewrite-findings.md`:

1. **Chroma cross-language retrieval** (J-12) — upload a document through Python, then ask
   the Java Agent something only that document answers. A mismatch returns *empty, with no
   error anywhere*.
2. **The inference path** — blocked on B-1. The repository has no weights, so
   `/diagnosis/diagnosis` failing closed is the correct current behaviour.

## Design Context

### Users
混合用户群——眼科医生（临床检查）、医院管理员（记录管理/系统运维）、普通患者（AI 自助诊断）。三种角色技术熟练度和使用场景差异大，界面需根据角色调整复杂度。

### Brand Personality
**温暖、专业、关怀**。赤陶色(#c96442)主色调 + 米色背景传递人文关怀，Georgia 衬线标题传达医疗专业性，柔和圆角和暖色阴影营造被温柔对待的感受。

### Aesthetic Direction
浅色为主的暖色调界面，深色主题作为补充。当前 claude-tokens.css 设计代币系统和 Ant Design Vue 主题定制方向正确，重构重点是提升精致度、优化排版层次、改善交互反馈、让深色主题达到同等完成度。

### Priority Areas
1. **诊断流程**：登录、首页、图片上传、诊断结果——用户最先接触的核心路径
2. **用户中心**：个人中心、诊断历史、通知——高频使用功能
3. **Agent 智能对话**：AI 对话、会话管理、资源面板——最复杂的交互界面

### Design Principles
1. **温度优先**：暖色调、柔和圆角、友善文案，让用户感到被关心
2. **角色自适应**：医生看专业数据，患者看通俗解读，同一系统不同复杂度
3. **克制之美**：赤陶色点缀而非铺满，每个视觉元素服务于信息或情感
4. **流畅过渡**：状态变化有流畅动效，传递系统响应性和可靠性
5. **双主题一致性**：浅色/深色传达相同品牌性格，非简单颜色翻转

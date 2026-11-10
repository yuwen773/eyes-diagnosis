# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Iris — **Spring Boot 3.5.6** (Java 21) + **React 19** 产品前端（`web/`）+
**Vue 3** 历史前端（`frontend/`）+ **Python** algorithm service.
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

后端构建脚本看 `pom.xml`，产品前端脚本看 `web/package.json`（`typecheck` / `test` / `build` / `lint`，
CI 里是根 `verify.yml` 的 `web` job），Vue 历史线看 `frontend/package.json`，算法服务看
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

**Frontend (product)** (`web/`): React 19 + TypeScript + Vite + Tailwind v4 + React Router. API 层手写于 `web/src/lib/api.ts`（统一 `ApiError` / `BaseResponse`），Agent 聊天用 `@microsoft/fetch-event-source` 消费 SSE。2026-11-10 起由 `git subtree` 纳入本仓库，原独立仓库 `eyes-diagnosis-web` 已归档。

**Frontend (legacy)** (`frontend/`): Vue 3 + TypeScript + Ant Design Vue 4 + Tailwind CSS v4 + Pinia + ECharts. API clients generated via `@umijs/openapi`. 历史线，新代码不要写在这里。

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

### Users
混合用户群——眼科医生（临床检查）、医院管理员（记录管理/系统运维）、普通患者（AI 自助诊断）。三种角色技术熟练度和使用场景差异大，界面需根据角色调整复杂度。

### Brand Personality
**冷静、精密、克制**。骨白工作台 + 信号橙作唯一强调 + 衬线标题 + 等宽读数，传达"这是一台可信的临床仪器"，而不是一个健康 App。温度靠文案与留白表达，不靠暖色调。

### Aesthetic Direction
**白色仪器（The White Instrument）**。设计真源是仓库根 `DESIGN.md`，令牌实现是 `web/src/styles/tokens.css`。
两条前端线：`web/`（React）是产品前端，本文件的规则都指它；`frontend/`（Vue）是历史线，仍跑旧的青绿 `--iris-*`，**不再作为设计参考，新代码不要写进 `frontend/`**。
写 `web/` 页面、组件、样式，或评审前端 diff 前 → 读根 `DESIGN.md`（品牌令牌、双主题、页面骨架、参考实现）。后端任务不需要读。

### Design Rules（写前端必须遵守）
- **品牌强调色是信号橙 `--signal: #d9541f`**（暗底 `#ef7a45`）。它**不是主 CTA 色**——主按钮是墨色 `--ink`；橙色只做语义强调（当前态、聚焦边框、模型标记、top 条），不做大面积填充。
- **严重度语义色与品牌色解耦**：`--risk-normal/attention/critical`，且必须同时给文字标签，颜色不是唯一信息载体。
- **所有数字用等宽字体** `--font-mono`（IBM Plex Mono）+ `tabular-nums`——置信度、概率、计数、时间戳、哈希。
- **衬线标题用 `--font-serif`（Noto Serif SC 栈），weight 只允许 400**，禁止 700+ 与斜体；正文与控件用 `--font-sans`。
- **圆角默认 0**（按钮、输入、卡片、表格），圆形用 50%，药丸 999px；不要堆圆角。
- **发丝线优先于厚重卡片阴影**，需要层级时才用极淡的墨色阴影。
- **AI 装饰零容忍**：不用粒子、扫描线、光环动画、圆形渐变装饰、居中 hero 大标题。
- **纸面原语 `--paper-*` 不参与主题翻转**：判读记录在任何主题下都是同一张白纸。
- 页面骨架：顶部 KPI 条（mono 指标 4 列）+ 章节 overline + 台账行 + `.card-accent` 顶部条。

### 参考实现
`web/src/styles/tokens.css`（全部令牌）、`web/src/components/RecordSheet.tsx`（记录纸）、`web/src/pages/LandingPage.tsx`、`web/src/pages/DiagnosisPage.tsx`。Vue 版的 `HomePage.vue` 等三页仅作历史参考。

### Priority Areas
1. **诊断流程**：登录、首页、图片上传、诊断结果——用户最先接触的核心路径
2. **用户中心**：个人中心、诊断历史、通知——高频使用功能
3. **Agent 智能对话**：AI 对话、会话管理、资源面板——最复杂的交互界面

### Design Principles
1. **克制 = 信任**：骨白与墨色为主，彩色只做语义，界面读起来像一份可信的判读报告
2. **角色自适应**：医生看专业数据，患者看通俗解读，同一系统不同复杂度
3. **橙只做语义**：信号橙标记"重点/当前"，铺满就失去意义
4. **流畅过渡**：状态变化有流畅动效，传递系统响应性和可靠性
5. **双主题一致性**：浅色/深色传达相同品牌性格，非简单颜色翻转

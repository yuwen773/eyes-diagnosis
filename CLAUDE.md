# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Iris — **Spring Boot 3.5.6** (Java 21) + **React 19** 产品前端（`web/`）+
**Vue 3** 已弃用前端（`frontend/`，deprecated）+ **Python** algorithm service.
Base package: `com.csust.eyediagnosis`

> **本分支是 Java 线。** 仓库里另有一条 Python 后端线（FastAPI），在 `feature/python-backend`
> 分支，与本分支**不再互相合并**；`frontend/`、`algorithm/` 下的 ML 部分等共享目录各持一份，
> 改动需人工搬运。约定见 `docs/backend-split.md`。

## Navigation

- 领域命名、模块边界、易混术语 → `GLOSSARY.md`（架构评审与新增概念前读）。
- 找设计 / 计划 / 验收 / 迁移文档 → `docs/README.md`（按主题分组的索引）。
- 改数据库 → `src/main/resources/db/migration/V*.sql` 是迁移真源；版本编号与历史决策见 `docs/flyway-migration-history-plan.md`。
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

**Frontend (product)** (`web/`): React 19 + TypeScript + Vite + Tailwind v4 + React Router. API 层手写于 `web/src/lib/api.ts`（统一 `ApiError` / `BaseResponse`），Agent 聊天用 `@microsoft/fetch-event-source` 消费 SSE。2026-11-10 起由 `git subtree` 纳入本仓库，原独立仓库 `eyes-diagnosis-web` 已归档。

**Frontend (deprecated)** (`frontend/`): Vue 3 + TypeScript + Ant Design Vue 4 + Tailwind CSS v4 + Pinia + ECharts. API clients generated via `@umijs/openapi`. **已弃用（deprecated，2026-11-10 起）**：不再开发、不再作为设计参考，仅保留可运行以作回溯；新功能与修复一律进 `web/`。

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
两条前端线：`web/`（React）是产品前端，本文件的规则都指它；`frontend/`（Vue）**已弃用（deprecated）**，仍跑旧的青绿 `--iris-*`，**不再作为设计参考，新代码不要写进 `frontend/`**。
写 `web/` 页面、组件、样式，或评审前端 diff 前 → 读根 `DESIGN.md`（品牌令牌、双主题、页面骨架、参考实现）。后端任务不需要读。
**Iris 2.0（2026-11-12 起）**：临床层不变，首页/品牌层新增 `.iris2` 语境（钴蓝 + 银蓝材质 + 极光紫，Manrope 拉丁字体），只服务 C 档，见 DESIGN.md §3.9。

### Design Rules（写前端必须遵守）
- **三档表达强度**（DESIGN.md §2.1）：A 临床判读（`Diagnosis`/`Records`/`RecordSheet`）保持最严；B 管理/数据分析（`admin/`、图表、弹层）允许分类数据色、4–8px 浮层圆角与 ≤240ms 状态过渡；C 品牌/Agent 视觉层允许有界动效与品牌渐变。**安全、医学措辞、可访问性、统计口径、证据链不因档位放松**。
- **品牌层是 Iris 2.0 的独立语境**（DESIGN.md §3.9）：`.iris2` 命名空间用钴蓝 `--brand-primary: #2457c9`（暗底 `#85b5ff`）、`--brand-cyan`、`--brand-aurora`（极光紫只做点缀），字体 `--font-brand`（Manrope Variable，中文回退 Noto Sans SC）。**只在 C 档首页/品牌组件用**，别去改 `--field/--ink/--signal`，也别让品牌蓝紫与 `--risk-*` 混用或同值。
- **品牌强调色是信号橙 `--signal: #d9541f`**（暗底 `#ef7a45`）。它**不是主 CTA 色**——主按钮是墨色 `--ink`；橙色只做语义强调（当前态、聚焦边框、模型标记、top 条），不做大面积填充。信号橙是**临床页**的语义色，与品牌层的钴蓝并存但不互换。
- **严重度语义色与品牌色解耦**：`--risk-normal/attention/critical`，且必须同时给文字标签，颜色不是唯一信息载体。
- **分类色只用于 B 档图表**：`--viz-series-1..6`（浅/暗两套），不得占用 `--signal` 或 `--risk-*`；用了分类色就必须同时有读数表/直标/图例/线型等第二通道。
- **所有数字用等宽字体** `--font-mono`（IBM Plex Mono）+ `tabular-nums`——置信度、概率、计数、时间戳、哈希。
- **衬线标题用 `--font-serif`（Noto Serif SC 栈），weight 只允许 400**，禁止 700+ 与斜体；正文与控件用 `--font-sans`。
- **圆角只用令牌梯**：`--radius-none/sm/md/lg/xl/2xl/circle/pill`（0 / 4 / 8 / 12 / 24 / 38 / 50% / 999px）；A 档主控件默认 0，B 档浮层 4–8px，C 档面板 8–12px（`xl/2xl` 只给品牌层大容器）。不再写像素自由值。
- **发丝线优先于厚重卡片阴影**；浮层用 `--shadow-overlay`，模态/抽屉用 `--shadow-modal`，阴影一律基于墨色。
- **装饰必须服从信息**：不用粒子、扫描线、光环动画、圆形渐变装饰、居中 hero 大标题；C 档动效必须有性能预算、离屏暂停与 `prefers-reduced-motion` 开关。
- **纸面原语 `--paper-*` 不参与主题翻转**：判读记录在任何主题下都是同一张白纸。
- **弹层统一走 Base UI**（`src/components/ui/dialog.tsx`）：Portal、焦点陷阱、inert、滚动锁、嵌套 Esc 栈不手写第二套；Portal 面板显式带 `.is-field` 等语境类。
- 页面骨架：顶部 KPI 条（mono 指标 4 列）+ 章节 overline + 台账行 + `.card-accent` 顶部条。

### 参考实现
`web/src/styles/tokens.css`（全部令牌）、`web/src/components/RecordSheet.tsx`（记录纸）、`web/src/pages/LandingPage.tsx`、`web/src/pages/DiagnosisPage.tsx`。Vue 版的 `HomePage.vue` 等三页已弃用，仅作历史参考。

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

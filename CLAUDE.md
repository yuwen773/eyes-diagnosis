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
- 写前端样式 / 评审前端 diff → 仓库根 `DESIGN.md`（**Iris 2.0 · Adaptive Visual System**，
  目标规范）+ `web/src/styles/tokens.css`（**已实现的令牌事实**）。
  两者不一致时以 `tokens.css` 为准，差异记在 `DESIGN.md` §8。
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
**冷静、精密、克制**；Iris 2.0 起加一句：**同一套品牌身份，四种表达强度**。
骨白工作台 + 衬线标题 + 等宽读数传达"这是一台可信的临床仪器"；首页/品牌层用
钴蓝 + 银蓝光学材质表达"这是一个能把复杂视觉信息讲清楚的团队"。
温度靠文案与留白表达，不靠暖色调。

### Aesthetic Direction
**Iris 2.0 · Adaptive Visual System**。设计真源是仓库根 `DESIGN.md`（目标规范），
令牌实现是 `web/src/styles/tokens.css`（已实现的事实）。
`web/`（React）是产品前端，本文件的规则都指它；`frontend/`（Vue）**已弃用（deprecated）**，
仍跑旧的青绿 `--iris-*`，**不再作为设计参考，新代码不要写进 `frontend/`**。
写 `web/` 页面、组件、样式，或评审前端 diff 前 → 读根 `DESIGN.md`
（场景规范、组件变体矩阵、双主题、可访问性、数据真实性）。后端任务不需要读。

### 四种体验场景（写前端先判断自己在哪个场景）
`DESIGN.md` §1–§2 是场景规范，§1.5 是**逐路由归属表**（每个真实路由属于哪个场景、
用什么容器类），§4 是**组件变体矩阵**（按钮/卡片/图表/导航/弹层/表格/表单/状态标记
× 四场景）。**没有"全站通用"的一套控件外观**；也**不是每个页面都套 KPI + 台账**。

| 场景 | 页面 | 主色 | 圆角 | 气质 |
|---|---|---|---|---|
| **Brand** | `LandingPage`/`LoginPage`/`RegisterPage`/`NewsPage`/`NewsDetailPage` | 钴蓝 `--brand-primary` | 24–38px | 精致、清透、留白足 |
| **Management** | `pages/admin/*` | 钴蓝主操作 + `--signal` 当前态 | 8–12px | 成熟 SaaS、信息密度高 |
| **Intelligence** | `AgentPage`、未来的影像工作台 | 运行态蓝/青、类别紫 | 12px | 专业、看得见协作 |
| **Clinical** | `DiagnosisPage`/`RecordsPage`/`ProfilePage`/`RecordSheet` | 墨色主 CTA + `--signal` 语义 | 0 | 克制、纸面稳定 |

登录/注册走品牌层双栏，个人中心与资讯是资料/编辑式排版——都不以 KPI + 台账开头。

### Design Rules（写前端必须遵守）
> 这是**索引**，不是规则正文。规则正文在 `DESIGN.md`，改动先改那里。
- **先定场景，再写样式**：Brand / Management / Intelligence / Clinical 四选一，
  它决定圆角、主色、动效预算（`DESIGN.md` §1.2、§4）。
- **三套语义色互不顶替**：`--signal`（临床重点/当前态）、`--brand-*`（品牌身份）、
  `--risk-*`（医学严重度）。主 CTA：Clinical 用墨色 `--ink`，其余场景用 `--brand-primary`。
  **信号橙永远不是主 CTA 色，也不大面积填充。**
  `--brand-*` 是**跨场景**的品牌语义令牌（管理端主操作、Agent 运行态都能取用）；
  `.iris2` 只是**品牌视觉容器**类，只在首页首屏用。两者不可混为一谈。
- **严重度必须同时给文字标签**（`RiskTag` 永远带文字 + 小圆点，不整块填色）；
  **分类色只用于 Management/Intelligence 的图表**（`--viz-series-1..6`），
  且必须同时有读数表/直标/图例/线型等第二通道，颜色不是唯一信息载体。
- **所有数字用等宽** `--font-mono`（IBM Plex Mono）+ `tabular-nums`——置信度、概率、
  计数、时间戳、哈希。衬线标题 `--font-serif`（Noto Serif SC 栈）weight 只允许 400；
  正文 `--font-sans`；品牌拉丁字 `--font-brand`（Manrope，**无汉字，不许兜底中文**）。
- **圆角只用令牌梯** `--radius-none/sm/md/lg/xl/2xl/circle/pill`
  （0/4/8/12/24/38/50%/999px），按场景取（Clinical 0、Management 8–12、Brand 24–38）。
  不再写像素自由值。（`xl`/`2xl` 随 PR #52 进入 `tokens.css`，合并前取不到。）
- **发丝线优先于厚重卡片阴影**；浮层 `--shadow-overlay`，模态/抽屉 `--shadow-modal`，
  阴影基于墨色（品牌玻璃用 `--brand-shadow`）。
- **装饰必须服从信息**：不用粒子、扫描线、光环动画、圆形渐变装饰、居中 hero 大标题。
  动效分两类：**氛围动效**（品牌材质自身在动，不要求绑定业务事件，仅 Brand）与
  **状态动效**（表示系统正在做什么，必须绑定真实后端事件/请求状态）。
  状态动效**四个场景都允许**——Clinical 与 Auth 的上传、提交、保存、加载与错误反馈
  同样是真实状态，只是表现更克制；**任何场景都禁止假进度、虚构执行状态与
  无意义的伪加载**。
  两者都：离屏即停、`prefers-reduced-motion` **实时订阅**当场停、可手动暂停（`DESIGN.md` §3.7）。
- **纸面原语 `--paper-*` 不参与主题翻转**：判读记录在任何主题下都是同一张白纸。
- **弹层统一走 Base UI**（`src/components/ui/dialog.tsx`）：Portal、焦点陷阱、inert、
  滚动锁、嵌套 Esc 栈不手写第二套；Portal 面板显式带 `.is-field` 等语境类。
- **不虚构业务能力**：界面上的每个数字都能追到后端端点与口径（全量/时间窗口/分页）；
  不虚构 KPI、准确率、AI 运行态；**设计稿里有 ≠ 产品里有**。
- **页面骨架按页面类型选**：只有**台账页**（`RecordsPage`、`pages/admin/` 下的
  列表页 users/news/diagnosis/knowledge）用
  「顶部 KPI 条（mono 指标 4 列）+ 章节 overline + 台账行 + `.card-accent` 顶部条」。
  管理端**概览页与数据分析页以 KPI 与图表为主**（没有台账），**新闻编辑页以表单为主**
  （既无 KPI 也无台账）——不要给 `pages/admin/*` 每页都塞四列 KPI。
  登录/注册用品牌双栏，个人中心用资料区 + 读数卡，资讯用编辑式列表，
  诊断页是上传槽 → 记录纸。逐路由归属见 `DESIGN.md` §1.5。
- **品牌首屏构图**：外层画布**全幅**铺满，玻璃外壳是 1240px 版心内的容器，光带裁在壳里
  （与 Optic Flow V4、PR #52 的 `LandingHero` 一致，`DESIGN.md` §3.6）。
- **公开路由共用一个产品外壳**（R2.5，`DESIGN.md` §1.6）：`/`、`/news`、
  `/diagnosis`、`/agent`、`/profile`、`/records` 共用同一顶栏组件、导航数据、
  账号菜单、主题切换与移动抽屉；场景只切换材质强度、当前态语义色与内容密度。
  **不许再新增第二个顶栏实现**。管理端保留独立侧栏，认证页保留无导航入口形态；
  页脚按页面性质取完整 / 精简 / 免责 / 不展示，不强行占用工作区。

### 参考实现
`web/src/styles/tokens.css`（全部令牌）、`web/src/components/RecordSheet.tsx`（记录纸）、
`web/src/pages/LandingPage.tsx`、`web/src/pages/DiagnosisPage.tsx`。
`web/src/components/brand/OpticFlow.tsx`（品牌层首屏）+ `--brand-*`/`.iris2`/`--radius-xl|2xl`
**只存在于 PR #52，尚未进入 `ui`**——合并前取不到，不能当作目标分支已有能力引用。
Vue 版的 `HomePage.vue` 等三页已弃用，仅作历史参考。

### 设计文档
| 文档 | 何时读 |
|---|---|
| `DESIGN.md` | 写 `web/` 页面/组件/样式，或评审前端 diff（**目标规范**） |
| `web/src/styles/tokens.css` | 查令牌真值（**已实现的事实**，与 DESIGN.md 冲突时以它为准） |
| `docs/design/iris-2-rule-change-matrix.md` | 想知道旧「白色仪器」规则改成了什么、为什么改 |
| `docs/design/iris-2-implementation-roadmap.md` | 想知道首页/管理端/协作台各自的实施顺序与门禁 |
| `docs/design/iris-2-r2-5-product-shell-audit.md` | 想知道 R2.5 为什么统一外壳、逐页现状与目标、PR 拆分 |
| `docs/design/IRIS_2_DESIGN_REFERENCE_BRIEF.md` + `docs/design/assets/` | 查视觉参考来源与取舍（**灵感，不是实现**） |

### Priority Areas
1. **诊断流程**：登录、首页、图片上传、诊断结果——用户最先接触的核心路径
2. **用户中心**：个人中心、诊断历史、通知——高频使用功能
3. **Agent 智能对话**：AI 对话、会话管理、资源面板——最复杂的交互界面

### Design Principles
1. **克制 = 信任**（Clinical 场景）：骨白与墨色为主，彩色只做语义，界面读起来像一份可信的判读报告
2. **角色自适应**：医生看专业数据，患者看通俗解读，同一系统不同复杂度
3. **橙只做语义**：信号橙标记"重点/当前"，铺满就失去意义；品牌钴蓝也不做大面积填充
4. **场景决定表达强度**：Brand / Management / Intelligence / Clinical 各有各的密度与材质，
   但安全、医学措辞、可访问性、统计口径、证据链**不因场景放松**
5. **流畅过渡**：状态变化有流畅动效，传递系统响应性和可靠性
6. **双主题一致性**：浅色/深色传达相同品牌性格，非简单颜色翻转
7. **不虚构**：界面上的每个数字都能追到后端与口径；设计稿里有 ≠ 产品里有

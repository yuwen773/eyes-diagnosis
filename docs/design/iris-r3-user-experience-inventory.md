# Iris R3 · 用户端产品体验重设计 · 现状盘点（Phase 0）

> 基线：`ui` @ `cf9e9351`（PR #92 之前）+ PR #92 整改批次（`fix/frontend-review-20261116`）。
> 盘点日期：2026-11-17。本文只写**盘点结论**，不写实现方案——实现分两个 Draft PR：
> Phase 1（Agent 工作区）、Phase 2（Journal 资讯体验）。

---

## 1. 这次改什么、不改什么

**改**：信息架构、版面骨架、组件结构、交互流程、动效预算。目标是让「用户端」从
「医疗仪器控制台」变成一个有品牌身份的 AI 医学产品。

**不改**：

| 领域 | 口径 |
|---|---|
| SSE 事件类型与语义 | `assistant` / `reasoning` / `tool-request` / `tool-confirm`（+`mcp-confirm`），不改名、不加字段、不改顺序含义 |
| 医学风险标签 | `--risk-*` 的严重度含义一字不动 |
| 权限与账号隔离 | 会话、资源、记录一律按当前账号走，后端的账号级校验不动 |
| Markdown 渲染与净化链 | `markdown-it` + `DOMPurify` 白名单 + `sanitizeNewsHtml`，不另起炉灶 |
| 数据查询机制 | 仍是 TanStack Query，不新增第二套请求层或状态机 |
| 现有业务能力 | 重命名 / 置顶 / 删除 / 批量删除 / 导出 / 草稿 / 图片附件 / 分页 / 检索，全部保留 |

**明确不做**：模型选择、推理强度、语音输入、知识库切换开关——后端没有对应契约，
前端不能造。

---

## 2. 逐路由现状与处置

| 路由 | 场景 | 现状问题 | 处置 |
|---|---|---|---|
| `/agent` | Intelligence | 会话挤在左侧、右侧大片空白；输入框是一条窄底栏；执行过程用仪表读数（`DIAGNOSIS · AGENT`、`N MSG`）表达 | Phase 1：三栏工作区（会话 260–288px / 阅读列 760–840px / 资源栏 300–340px）、多行输入、执行过程改「思考线」 |
| `/news` | Brand | 头版 hero 占满一屏，刊名/副标题/检索各占一行，真实资讯要滚两屏；条目是发丝线行，没有封面层次 | Phase 2：期刊抬头（刊名 + 检索 + 真实头条同屏）+ 编辑式内容卡网格 |
| `/news/:id` | Brand | 正文 68ch 阅读宽度；目录在窄屏仍钉在左侧占一列；锚点跳转是瞬时的 | Phase 2：728px 阅读宽度、窄屏目录收成可折叠、平滑锚点滚动 |
| `/diagnosis` | Clinical | — | Phase 3（待确认） |
| `/records`、`/records/:id` | Clinical | — | Phase 3（待确认） |
| `/profile` | Clinical | — | Phase 3（待确认） |

管理端（Purple Medical SaaS）**不在本次范围内**。

---

## 3. 保留清单（明确不许动）

1. `NewsArticleView` 作为**公开页与管理端预览共用的唯一正文组件**。管理端预览把
   同一份组件装进设备框（1240 / 390 逻辑宽度 + `transform: scale()`），任何「预览
   另写一套版式」的做法都会让管理员对着一个不存在的页面签字。
2. 现有的 HTML / Markdown 双来源净化链与字数口径（预览读数与公开页同口径）。
3. `sanitizeNewsHtml` 的白名单——正文里的脚本、事件属性、危险链接必须继续被剥掉。
4. 后端返回的真实字段原样透出：发布时间、标题、摘要、正文、封面、作者。
5. `useRevealScan` / `.reveal → .is-in` 的入场动画基元（既有能力，不另造一套）。

---

## 4. 要删的旧样式（Phase 2 已删）

| 旧类名 | 为什么删 |
|---|---|
| `.news-hero` / `.news-hero__*` | 整屏 hero 是「顶部死空间」的来源，抬头已经取代它 |
| `.news-lead` / `.news-lead--text` / `.news-lead__*` | 头版卡被期刊抬头的真实头条取代 |
| `.news-rows` / `.news-rows__item` / `.news-row*` | 发丝线行换成内容卡网格 |
| `.news__masthead` / `.news__title` | 旧报头，改为 `.journal__*` |
| `.news-skeleton__lead` / `.news-skeleton__rows` / `.news-skeleton__row` | 骨架改成与真卡同形（`.news-skeleton__card`），加载完切换时版式不跳 |

---

## 5. 数据与医学语义盘点（真实读数，不补字段）

**资讯（`t_news` → `NewsVO`）**：接口真实返回 `id / title / author / avatar /
content / summary / coverImage / publishTime / status / category / source / featured /
offlineReason`。

- `category`、`source`、`featured` **恒为 null / 0**——数据库列存在，但读侧没填。
  前端因此**不显示分类、不显示来源、不显示精选标**：字段在，值不在。
- `author` 由后端从 `t_user` 反查，查不到时兜底成「未知用户」，不会返回 null。
- `publishTime` 在表上是 `NOT NULL`，所以「缺发布时间」只在前端自己的兜底分支里
  出现——前端不留 `—` 占位，宁可那一格空着。
- `coverImage` 对应库里的 `coverImg`（字段名差异由后端 `toNewsVO` 收拢）。库里
  20 条已发布资讯里 4 条有封面，其余没有。**没有封面就不摆图位**，不拿占位图补位。

**Agent（SSE）**：

- 后端 `DiagnosisAgent.stream()` 只映射 `AssistantMessage`（tool-request /
  reasoning / assistant）与 `InterruptionMetadata`（tool-confirm）。
  **`tool-response` / `tool-result` 永远不会被发出**（已用真实 SSE 抓包核对，
  事件序列里不存在）。
- 因此：一次工具调用在前端会停在「执行中」，流结束后转为「待返回」——
  这是**如实反映**，不是前端漏画。资源面板依赖 `tool-response` 才能填，
  内置 RAG 工具（`searchDocuments`）目前**填不满资源面板**。
- `tool-confirm` 是「知会式暂停」：可以展开看参数与说明，**没有「批准」按钮**
  （后端没有批准语义，造一个按钮就是骗人）。
- 工具参数与返回值进 DOM 前过一遍 `sanitizeToolArgs` 脱敏：key、token、路径类
  参数不直接显示。

---

## 6. React Bits：参考与许可结论

参考对象：Prompt Bar、Thought Line、Lattice Loader、Animated Content、Glare Hover。

**结论：五种交互全部独立实现，未复制上游源码，未引入上游依赖。**

原因（许可原文见 `web/src/components/brand/THIRD-PARTY-NOTICES.md`）：React Bits 是
**MIT + Commons Clause v1.0**。MIT 允许把软件作为应用的一部分使用、修改、发布；
Commons Clause 额外禁止**销售、再许可、再分发组件本身——单独、打包、或以移植版
的形式**。本仓库是公开仓库，「把上游组件源码搬进来」正落在移植版再分发这条线上，
「免费使用」不等于「可以抄源码」。

独立实现各自的取舍：

| 交互 | 上游做法 | 本仓库做法 | 依赖 |
|---|---|---|---|
| Prompt Bar | 独立组件 + 自己的状态 | 拆成无状态 `PromptBar`（摆件）+ `ChatInput`（状态），输入框仍归 `ChatInput` | 零新增 |
| Thought Line | 动画行 | 纯 CSS 状态行，数据来自 `buildThread` 的纯派生 | 零新增 |
| Lattice Loader | canvas / WebGL | 纯 CSS 点阵 | 零新增 |
| Animated Content | 进场动画 | 复用既有 `.reveal → .is-in` | 零新增 |
| Glare Hover | canvas 逐帧绘制 | 一层 CSS 径向渐变跟随指针（`--gx` / `--gy` 写进 CSS 变量，不触发 React 重渲染） | 零新增 |

**没有新增任何依赖**：Motion / GSAP / Three.js / Hugeicons 一个都没进来。图标只用
既有的 `lucide-react` 静态命名导入。

---

## 7. 证据位置

- 截图：仓库外的临时目录（不入库），390 / 768 / 1440 × 浅色 / 深色，逐状态一张。
  采集脚本同在临时目录。
- 单测：`web/src/components/news/*.test.tsx`、`web/src/lib/useElementWidth.test.tsx`、
  `web/src/lib/agentSteps.test.ts`、`web/src/components/agent/*.test.tsx`。
- 后端：本地 MySQL 8（3307）+ Spring Boot（8081）+ ChromaDB + Redis，真实数据、
  真实 SSE、真实图片。

---

## 8. 已知的后端缺口（前端不补，留给后端单独立项）

1. **SSE 不发 `tool-response`**：工具调用的结果永远回不到前端，资源面板因此填不满。
   要么后端补发该事件，要么资源面板改从别的来源取——两条都动后端契约，本次不动。
2. **`t_news` 的 `category` / `source` / `featured` 读侧恒空**：要么读侧填值，
   要么把列删掉。前端目前按「没有这些字段」呈现。
3. **资讯没有「作者资质 / 引用来源」字段**：文章里的普通链接因此只是链接，
   不被包装成临床证据——这是前端的口径，不是后端的缺陷。

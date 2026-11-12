# Iris 2.0 · Adaptive Visual System

> **这是 `web/`（React 产品前端）的目标设计规范。**
>
> **真源优先级（不要搞反）**
>
> | 层级 | 文件 | 地位 |
> |---|---|---|
> | 1 · 已实现的令牌事实 | `web/src/styles/tokens.css` | 令牌值**以它为准**。本文引用的任何色值/尺寸若与它不一致，说明本文是**目标**、代码是**现状**，差口列在 §8 与 `docs/design/iris-2-rule-change-matrix.md` |
> | 2 · 目标规范 | 本文件 | 规则、场景规范、组件变体矩阵 |
> | 3 · 简明索引 | 根 `CLAUDE.md` | 只放执行原则与指向，**不复制规则正文**，避免第二份真源 |
>
> **适用范围**：只管 `web/`。Vue 线 `frontend/` **已弃用（deprecated）**，
> 它的旧青绿 `--iris-*` 规则留在 `docs/design-system.md`，**不是**本规范的参考。
>
> **参考包**：`docs/design/IRIS_2_DESIGN_REFERENCE_BRIEF.md`（设计简报，含 A/B/F/G/H/I
> 参考代号定义、原始来源链接与取舍说明）与 `docs/design/assets/`（Iris 自有的
> Optic Flow V4 概念图与源文件）。**简报是灵感来源，不是实现说明**；第三方作品
> 只作视觉分析参考，其截图与图标不得进入产品。
>
> **本文的状态标注约定**（每条规范都要能回答"现在做到哪了"）：
>
> | 标记 | 含义 |
> |---|---|
> | ✅ **已实现** | 代码在 `ui` 分支上已落地，可直接使用 |
> | 🅿 **在 PR 中** | 随 PR #52（`feat/iris-2-optic-flow` → `ui`）落地，合并后生效 |
> | 🗓 **规划中** | 规范已定，代码未写 |
> | ◌ **仅示意** | 只存在于参考概念稿里，**不是**产品能力，也不应被描述成已实现 |
>
> **硬约束**：后端 API 契约已冻结（Architecture Frozen）。设计升级只换皮、换结构，
> **不改任何数据流与端点**。医学安全、风险语义、人工复核、证据链、数据隔离、
> 可访问性在所有场景下**一条都不放松**（§5）。
>
> 2026-11-12：本文件由「Iris · 白色仪器（The White Instrument）」总纲升级而来。
> 旧理念作为**临床场景的设计历史**保留在 §1.4 与 §2.4，不作废、不删除。

---

## 0. 一句话主张

**同一套品牌身份，四种表达强度。**

Iris 2.0 不再要求全站长得一样。它把"看起来像一个可信的临床产品"这件事拆成
四类使用场景，各给各的密度、材质与动效预算，但**共享同一套品牌色板、排版尺度、
语义色、交互反馈、可访问性底线与数据诚实性**。

- 首页要**精致、清透、有空间感** → 品牌层（钴蓝 + 银蓝光学材质）
- 管理台要**成熟、密度高、可操作** → 管理场景（实体卡片 + 分类数据色）
- 协作台要**专业、看得见协作** → 智能层（深色画布 + 运行态反馈）
- 判读页要**克制、可信、不打扰** → 临床层（骨白纸面 + 信号橙语义）

底线不变：**医疗准确性、风险语义、人工复核、可追溯证据、登录数据隔离、
性能与可访问性优先。视觉可以大胆，但不能牺牲真实内容。**

---

## 1. 场景模型

### 1.1 为什么是四个场景，而不是一条全局尺度

旧版总纲用"三档表达强度"（A/B/C）解决问题：把全站按严苛程度分成三桶，
桶内规则相同、桶间规则不同。这个模型能撑住"判读页 vs 管理端"的差异，
但撑不住新出现的两类需求：

- 首页品牌层需要**玻璃材质 + 品牌渐变 + 大圆角容器**，它既不是临床页也不是管理端；
- 多 Agent 协作与影像工作台需要**深色观察画布 + 面板分栏 + 运行态动效**，
  它是第四种东西，硬塞进"C 档品牌/Agent 视觉层"会让 C 档的规则自相矛盾。

因此改为**按体验场景建模**。场景不是权限分区、不是路由分组，而是"用户在做什么、
需要多大信息密度、允许多大视觉主张"的判断。同一套令牌、同一个组件库，
在不同场景下取不同的**变体**（§4）。

### 1.2 场景 × 表达强度

| 场景 | 英文 | 表达强度 | 主要页面 | 核心诉求 |
|---|---|---|---|---|
| 品牌 | Brand | **高** | `LandingPage` | 精致、清透、科技感、空间感 |
| 管理 | Management | **中** | `pages/admin/*` | 成熟 SaaS、信息密度、操作效率 |
| 智能 | Intelligence | **中高** | `AgentPage`、未来的影像工作台 | 专业影像观察、真实协作可见、证据可追溯 |
| 临床 | Clinical | **低** | `DiagnosisPage`、`RecordsPage`、`RecordSheet` | 克制、可信、不打扰、纸面稳定 |

**强度不等于"更花"**：Brand 高指的是材质与排版主张强，不是彩多动多；
Clinical 低指的是视觉干扰少，不是信息少。

### 1.3 旧三档（A/B/C）的归位

旧规则不作废，重新挂到新场景上，避免同一件事有两套叫法：

| 旧档 | 新归属 | 变化 |
|---|---|---|
| **A 临床判读** | → **Clinical** | 规则保留：仍是直角、发丝线、单强调色、等宽读数，**主 CTA 仍是墨色** |
| **B 管理 / 数据分析** | → **Management** | **放宽**：卡片与面板允许 8–12px 圆角与实体层次；主操作允许用品牌钴蓝 |
| **C 品牌 / Agent 视觉层** | → 拆成 **Brand**（品牌材质与动效预算）+ **Intelligence**（协作与工作台） | **拆分**：Brand 的渐变/大圆角/玻璃不进工作台；工作台的面板分栏与运行态反馈不进首页 |

### 1.4 「白色仪器」是什么地位

旧理念——骨白工作台、信号橙语义、等宽读数、发丝线优先、装饰服从信息——**没有废**。
它是 **Clinical 场景**的设计语言，并且它的三条原则被提升为**全站通用原则**：

1. **数字是读数**：所有数字、时间戳、哈希、置信度一律等宽 + `tabular-nums`。
2. **发丝线优先于厚重阴影**（Brand 场景例外，因为玻璃材质本来就用阴影与高光分层）。
3. **装饰必须服从信息**（§3.7 给出各场景的例外边界）。

「白色仪器」不再是**全站**的描述，而是一个场景的名字。

---

## 2. 四个场景的规范

### 2.1 Brand Experience · 首页与品牌落地页

参考代号 **A · Aqua Flow / 液态光学玻璃** + **B · Blue Lab / 钴蓝生命科学**
（定义见 `docs/design/IRIS_2_DESIGN_REFERENCE_BRIEF.md` §1）。

**目标气质**
精致、清透、大胆、有空间感。不是仪器说明书，也不是粒子炫技页。让人相信
"这是一个能把复杂视觉信息讲清楚的团队"，而不是"这是一个炫技 Demo"。

**页面结构**（首屏 → 下半页）

| 区块 | 内容 | 状态 |
|---|---|---|
| 品牌导航 | 字标 + 药丸导航 + 主 CTA（「探索平台」） | 🗓 规划中 |
| 首屏眉线与标题 | `INTRODUCING IRIS 2.0 / THE FUTURE OF VISION` + `VISION, REIMAGINED.` + 中文副标题 | 🅿 在 PR 中 |
| 首屏 CTA | 「探索影像分析」「探索 AI 协作」，指向真实路由 | 🅿 在 PR 中 |
| 主视觉 | 一条连续蓝青光学带（WebGL2 单渲染器）+ 内部细纤维（SVG 层）+ 暂停动效按钮 | 🅿 在 PR 中 |
| 玻璃信息卡 | 「影像 / 分析 / 证据」流程卡，标注「流程示意 · 非实时结果」 | 🅿 在 PR 中 |
| 产品入口 | 三张卡：影像分析 / Agent 协作 / 证据与复核（链接指向真实去处） | 🅿 在 PR 中 |
| 仪器读数条 | 4 列 mono 读数（覆盖 8 类 / 模型 B4 / 质量门 / 复核溯源） | 🅿 在 PR 中 |
| 免责条 | 「AI 辅助信息展示 · 不构成临床诊断结论」 | 🅿 在 PR 中 |
| 首页下半页 | 眼底影像示意 / 样本 / 流程 / 判读记录 / Agent / 边界 / 行动 | ✅ 已实现（旧语境） |

**Light**
`#F2F6FC` 银蓝画布、白色/半透明面板、钴蓝强调、冰青反射。玻璃感要**通透**，
不是灰蒙：面板用 `--brand-glass`（白 68%）+ 一根发丝高光，而不是一层灰。

**Dark**
`#0B1425` 午夜蓝画布、`#17263D` 深蓝表面、冰蓝边缘光、**很少量**紫色反射。
**不允许纯黑 + 过度霓虹**；不允许大面积发光把标题吃掉。

**字体**
拉丁展示与导航用 `--font-brand`（Manrope Variable，200–800 可变字重）。
中文一律回退 Noto Sans SC（Manrope 无汉字，**不要拿它兜底中文**）。
数字与眉线用 `--font-mono`。

**颜色与材质**
钴蓝 `--brand-primary` 是这一层的品牌色；`--brand-cyan` 只做光学材质里的冷调高光；
`--brand-aurora` 极光紫只做**点缀**，面积不超过一个色块，不承载文字语义。
材质是"玻璃"：半透明面板 + 发丝描边 + 极淡蓝墨阴影（`--brand-shadow`），
**不是**模糊遮罩特效。

**组件复用**
沿用（🅿 PR #52 引入的）React 生态：`web/src/components/brand/`（`LandingHero.tsx`、
`BrandPanel.tsx`、`OpticFlow.tsx`）、`web/src/styles/brand.css`、`Base UI`（弹层与基础交互）。
**不引入新的 UI 库，不自研图表，不做第二套设计系统。**

**真实业务约束**
- 首屏**只允许一个正在运行的 GPU 背景**。细纤维是同一画面上的 SVG/CSS 图层，
  **不另起第二个 WebGL 循环**。
- 降级是硬要求：WebGL2 不可用、上下文丢失、`prefers-reduced-motion`、低端机，
  四种情形都必须给出**可读且美观**的静态画面；背景**永不**降低文字对比度、
  永不遮住标题与 CTA。
- 首屏**不得**出现患者影像、不得出现虚构的准确率或诊断数字。
- 页脚/信息卡里的能力描述必须对应真实功能，未开发的写"规划中"，不写成已上线。

**反例**

- ❌ 多层 GPU 背景叠加（Beams + GridScan + Ghost Fibers 同时挂）。
- ❌ 三维材质压在标题上，文字对比度靠发光撑。
- ❌ 居中大标题 + 粒子雨 + 圆形渐变装饰（这套"AI 生成味"样板）。
  本项目的首屏是**左对齐排版**（PR #52 的 `VISION, REIMAGINED.` + 中文副标题），
  不要改回居中 hero。
- ❌ 拿概念稿里的虚构医学数字当产品指标。
- ❌ 玻璃做成灰蒙蒙一片（`backdrop-filter` 叠太厚）。

**当前完成状态**
🅿 **首屏在 PR #52**：品牌令牌（`--brand-*`、`--font-brand`、`--radius-xl/2xl`、`.iris2`
语境类）、`LandingHero.tsx`（眉线 / 标题 / 双 CTA / 玻璃流程卡 / 三张入口卡 /
仪器读数条 / 免责条）、`OpticFlow.tsx`（WebGL2 Beams + SVG 纤维 + 静态降级 +
暂停动效）、`brand.css`。验收截图随 PR #52 入库于 `docs/assets/iris2/`
（390/768/1440/1920 × 亮暗 + 两条降级路径）。

✅ **首页下半页已存在**：眼底影像示意、样本局部、流程、判读记录、Agent 演示、
边界声明、行动区，链接都指向真实路由。

🗓 **未落地**：药丸化品牌导航；**首页下半页仍走旧的骨白/暗房语境**
（`--field` / `--night-bg`），与品牌层**同页两套底色共存**是已知技术债（§8），
计划在首页二期统一到 `--brand-*`。

---

### 2.2 Management Experience · 管理后台

参考代号 **F · Violet Clinical / 现代医疗 SaaS** + **G · Clinical AI / 智能数据台**。

**目标气质**
成熟医疗 SaaS：柔和但不软弱，功能优先、数据可读、操作性强。强调"管理与行动"。
**不照搬首页的 3D / 玻璃视觉**——管理台是一台每天要坐八小时的工作台，不是海报。

**页面结构**（稳定骨架，7 个管理页共用）

```
侧边导航（常驻，窄屏折叠为抽屉）
└── 页头：位置 + 上下文标题 + 主操作
    ├── KPI 区（关键指标，mono 读数）
    ├── 任务/状态区（待办、需复核、失败项）
    ├── 趋势区（图表）
    ├── 筛选区（工具栏 + 日期/状态筛选）
    ├── 台账区（表格，排序/分页/批量）
    └── 详情层（抽屉 / 模态）
```

**Light**：冷白 / 浅蓝灰背景、白卡、钴蓝作主要操作色、低饱和青/紫分类色；
卡片与画布分层清晰。

**Dark**：深海蓝背景与分层面板；**图表系列亮度单独调整**；浅色文字与指标必须满足
对比度；**不会把所有 KPI 都渲染成发光渐变**。

**字体**
界面与表格用 `--font-sans`；KPI 数值、计数、占比、时间戳用 `--font-mono`；
区块标题用 `--font-serif`（weight 400）。**不需要** Manrope——管理端不是品牌页，
拉丁字少，Manrope 在这里是浪费一次字体下载。

**颜色与材质**
- 品牌钴蓝 `--brand-primary` **可以**用作主操作色与链接（这是与旧版最大的差别）。
- 信号橙 `--signal` 退回到它的本职：**当前态 / 重点标记**，不再当主 CTA。
- 分类数据色 `--viz-series-1..6` 用于图表系列，**不占用** `--signal` 与 `--risk-*`。
- 材质：实体卡片 + 发丝描边 + 极淡墨色阴影（`--shadow-overlay`）。
  **允许 8–12px 圆角**，卡片间距有规律，**不堆多重内嵌容器**。

**组件复用（不得重造）**
`TanStack Query`（服务端状态）、`TanStack Table`（表格/排序/分页）、`Recharts`（图表）、
`Base UI`（`components/ui/dialog.tsx`、`menu.tsx`）、`web/src/components/admin/` 下现成的
`DataTable / Toolbar / StatTile / BatchBar / Drawer / Modal` 与 `charts/*`。
**不得**因为要做设计稿而自研排序、焦点陷阱、Dialog 或自己画图表。

**真实业务约束（后端有的就画，没有的不许画）**

| 管理能力 | 后端依据 | 口径要求 |
|---|---|---|
| 用户管理（列表/建/改/删/批量改角色） | `listUsers / createUser / updateUser / deleteUser / deleteUsers / updateUserRole` | 批量操作必须部分失败如实回执 |
| 资讯管理（列表/编辑/发布状态/删除/封面） | `listAdminNews / getNews / saveNews / changeNewsStatusBatch / deleteNewsBatch / uploadNewsCover` | 公开端只见已发布；管理员同端点看全状态 |
| 判读管理（列表/详情/**人工复核**/删除/批量） | `listDiagnoses / getDiagnosis / submitReview / deleteDiagnosis(s)` | 复核状态、拒识标记、复诊状态分列，不合并成一个"状态" |
| 知识库（上传/列表/详情/改名/删除/批量） | `uploadKnowledge / listKnowledge / getKnowledgeDetail / updateKnowledgeTitle / deleteKnowledge(s)` | 失败项要能定位到文档 |
| 数据分析 | `getAdminStats(days)` | **全量 / 时间窗口 / 分页**三种口径必须分别标注，不许混在一张卡片里 |

**硬约束**
- **不虚构 KPI**。任何数字必须能追到上面某个端点。
- **切时间窗必须立即失效 + 占位**：不能 Tab 显示 30d、卡片却留着 7d 的旧缓存。
- 图表**不能只靠颜色区分**：每个系列都要有读数表、条端直标、图例文字、线型/marker
  之一；tooltip 与 `aria-label` 里带系列名。
- **不把首页的 Beams 铺到管理页面**。管理端要的是密度，不是气氛。

**反例**

- ❌ 卡片里放虚构的"营收 ¥ 2,340,000"（概念稿里的样例数据）。
- ❌ 一个 Tab 显示 30 天，旁边的 KPI 卡还是 7 天的旧读数且无提示。
- ❌ 折线只有颜色区分，没有直标/图例/读数表。
- ❌ 每一层都套卡片（卡片里再套卡片再套内嵌容器）。
- ❌ 为了"有科技感"给每个 KPI 加发光渐变。

**当前完成状态**
✅ **页面与数据层已实现**：`web/src/pages/admin/` 下 7 个页（Dashboard / DataAnalysis /
Users / News / NewsEdit / Diagnosis / Knowledge）+ `AdminLayout`、`DataTable`（TanStack Table）、
`charts/*`（Recharts）、`Modal` / `Drawer`（Base UI）、TanStack Query 接入。

🗓 **视觉规范未落地**：当前仍是旧 B 档外观——主按钮是全局 `.btn`（墨色、0 圆角），
信号橙只做当前态指示条、焦点环与 swatch（**不是主操作色**）；
少数浮层已用 `--radius-md` / `--radius-sm`，其余仍是直角。
本节（圆角 8–12px、实体卡片层次、**钴蓝主操作**、深海蓝暗底）是**目标**，
落地属于路线图阶段 R3（见 `docs/design/iris-2-implementation-roadmap.md`）。

---

### 2.3 Intelligence Experience · 多 Agent 协作与眼科影像工作台

参考代号 **H · AI Command / 实时 AI 指挥台** + **I · Imaging Workspace / 医学影像工作空间**。
工作流另参考 V7 Darwin 的医学影像查看与标注流程（**只看工作流，不看配色**）。

**目标气质**
专业影像工作区 + 真实的 AI 多智能体协作。要"**看到协作**"，而不是一个聊天框
加一条假进度条。

**页面结构（四区，不是全屏聊天）**

| 区域 | 内容 | 状态 |
|---|---|---|
| 主区 · 影像 | 眼底影像、双眼对比、缩放平移、标注/疑点、**影像质量提示** | 🗓 规划中 |
| 协作区 | Agent 节点与状态（等待 / 执行中 / 完成 / 失败 / 待人工确认）、工具调用、时序、任务依赖 | 🗓 规划中（协议未定义） |
| 证据区 | 模型版本、工具来源、影像来源、引用/检索证据、置信度与限制、复核与来源标注、免责 | 🗓 规划中 |
| 对话区 | 问答交互，作为工作台的**一个子区域** | ✅ 已实现（`AgentPage`） |

**影像画布的硬约束**
主画布在**任意主题**下都使用**稳定的中性深色**——观察影像要的是中性灰阶，
不是品牌蓝或暖白。浅色主题下是"浅色操作框架 + 中性深色影像区"，暗色主题下是
"深蓝/深石墨框架 + 稳定深色影像区"。

**Light**：浅色操作框架（`--field` 系）+ 中性深色影像画布；证据与 Agent 卡片可用
淡蓝、冰青、局部紫色区分层次。

**Dark**：深蓝/深石墨框架 + 稳定深色影像区；**微弱发光仅用于运行态**，
保证病变区域与标注清晰。

**字体**
界面 `--font-sans`；证据引用、模型版本、工具名、时间戳 `--font-mono`；
区块标题 `--font-serif`（weight 400）。动效状态点旁的读数用 mono。

**颜色与材质**
四套语义**必须分开**，不得互相替代：

| 语义 | 用哪套色 | 说明 |
|---|---|---|
| 运行态（执行中） | 品牌蓝 / 冰青 `--brand-primary` / `--brand-cyan` | 只表示"在跑" |
| 智能体类别 | 允许局部紫 `--brand-aurora` | 只做类别标识，不表示严重度 |
| 待人工复核 | **独立审查状态**（中性强调 + 文字标签） | 不是"高风险"，是"等人" |
| 临床病情严重度 | **只能用** `--risk-normal / --risk-attention / --risk-critical` | 医学语义，与上面三套互不顶替 |

材质：工作台面板用实体分层（`--surface` / `--surface-2`），影像区用中性深灰，
发光只出现在运行态的边缘与状态点。

**组件复用**
扩展现有 `web/src/lib/agentStream.ts` 的事件模型；复用 `web/src/components/agent/` 的
`MessageList / ChatInput / SessionList / ResourcePanel`、`Base UI` 弹层与菜单、
`Recharts`。**不重写 SSE 客户端，不另造编排引擎。**

**真实业务约束（本节最容易出事的地方）**

- 只展示**后端实际产生**的事件。当前 `agentStream.ts` 的消息类型是
  `user / assistant / reasoning / tool-request / tool-response / confirm`，
  终态事件是 `event: "done"`。**多 Agent 编排、任务依赖、运行态推流目前不存在**。
- 目标事件字段（**目标接口建议，不是已实现**）：
  `runId, agentId, stepId, status, tool, evidenceRef, timestamp`。
  字段定下来之前，界面上**不许画**运行态节点、不许画假的进度条。
- **"高风险"永远不能用紫色品牌渐变代替临床警示。**
- **不虚构 Agent 活动**：没有真实事件就不显示事件流。
- **不复制**心脏扫描、生命体征、急诊队列等非眼科业务语义；
  不引入基因合成、3D 生物模型等非本产品领域的概念。

**反例**

- ❌ 用一堆假 Agent 卡片冒充"正在执行"。
- ❌ 紫色渐变标"高风险"。
- ❌ 为了沉浸感把影像压暗、盖住病灶或降低标注对比度。
- ❌ 聊天框独占全屏，影像与证据被挤成小窗。
- ❌ 把第三方概念稿里的"急诊队列"搬进眼科项目。

**当前完成状态**
✅ **`AgentPage` 已实现**：单会话问答 + SSE 流式（`assistant / reasoning /
tool-request / tool-response / confirm`）+ 会话列表 + 资源面板 + 附件。
`web/src/components/agent/` 完整。

🗓 **未落地**：多 Agent 协作视图、影像工作台（主画布/标注/双眼对比/质量提示）、
证据区结构化呈现、运行态可视化。**后端协议未定义**，本节是目标规范。

---

### 2.4 Clinical Experience · 诊断记录、人工复核、医学判读

参考代号无新增——这一场景**保留旧版全部已验证规则**，并把两处此前散落各处的
规定收拢到一处：主 CTA 的颜色（仍是墨色）、复核与拒识的状态区分。

**目标气质**
克制、可信、不打扰。像一份可信的判读报告，不像一个健康 App。
医疗风险语义、拒识、待复核、模型版本、证据链、人工签字、免责、数值口径、
可访问性是**不可妥协约束**。

**页面结构**
`DiagnosisPage`（上传 → 判读）→ `RecordSheet`（记录纸）→ `RecordsPage`（台账）→
`RiskTag`（严重度标记）。`RecordSheet` 的结构固定：页头（编号/模型/时间）→
结论 → 读数（置信度/严重度/复核）→ 置信环 → 八类概率尺 → 建议 → 复核提示 →
印章排 → 免责。

**Light / Dark**
纸面原语 `--paper-*` **不参与主题翻转**：判读记录在任何主题下都是**同一张白纸**
（`html.dark .is-sheet` 把纸白与纸上的深墨钉回去）。
暗主题下页面底是暗房，**纸还是纸**。这是全系统最不能动的一条。

**字体**
标题 `--font-serif`（weight 400）；正文 `--font-sans`；
**所有读数 `--font-mono` + `tabular-nums`**——置信度、概率、计数、时间戳、哈希。

**颜色与材质**
- 信号橙 `--signal` 是**本页的强调色**（当前态、模型标记、top 条、链接强调）。
- **主 CTA 在临床页保持墨色**（`--ink`），因为这里的主操作常常是"上传""提交复核"
  这类与医疗责任相关的动作，用彩色会把"重点"和"危险"混在一起。
- 风险语义 `--risk-*` 与品牌色**完全解耦**，改一个不动另一个。
- 材质：纸面 + 发丝线，**方角**（`--radius-none`）。

**组件复用**
`RecordSheet.tsx`、`RiskTag.tsx`、`ClassScale.tsx`、`ConfidenceDial.tsx`、
`DisclaimerBar.tsx`、`EmptyFrame.tsx`、`FaultNote`/`FaultToaster`。

**真实业务约束**
- **「判读」是产品动作，「诊断」是医疗行为**。界面一律用"判读"：
  「AI 判读结果」而不是"主诊断"，「判读记录」而不是"诊断记录"。
- 主诊断与 AI 辅助判读**不能混为一谈**。
- 置信度一律**百分比 + 一位小数**，缺省显示 `—`（不是 0）。
- 拒识（`aiRejected`）与"待复核"（`requiresReview`）是**两个独立状态**，
  分别标注，不合并成一个"状态"。
- 人工复核提交（`submitReview`）只有 `humanResult` 是必填；`humanSeverity`、
  `humanRecommendations`、`humanReviewNote` 在类型上可选。**界面上这四个位置必须都在**，
  填了就必须显示，不许因为字段可选就不呈现，也不许降级为脚注；
  复核人为当前登录管理员，其身份要可追溯。
- 建议按急症措辞分级：急症行标红并配「急」字签，**颜色不是唯一信号**。

**反例**

- ❌ 把主诊断写成"AI 已确诊"。
- ❌ 风险等级只用颜色表示，没有文字标签。
- ❌ 暗主题下判读记录变成深底白字（那不是纸了，是屏幕）。
- ❌ 把"高风险"写成品牌紫渐变。

**当前完成状态**
✅ **已实现**：`DiagnosisPage`、`RecordsPage`、`RecordSheet`（含测试）、
`RiskTag`、`ClassScale`、`ConfidenceDial`、`DisclaimerBar`。
规则与实现基本一致；**唯一差口**是复核字段在类型上可选（见上），界面上要补齐位置。

🗓 **计划中的小幅放宽**：主 CTA 颜色在临床页**保持墨色不变**；放宽只发生在
管理端（§2.2）与品牌层（§2.1）。如果将来要在临床页引入品牌色，只能作为
**非语义装饰**，且不得靠近判读结论区。

---

## 3. 跨场景共享规范

### 3.1 令牌架构（三层）

```
第 0 层 · 原语（primitive）
  --paper-*      纸面原语，永不翻转（纸白 + 纸上的墨）
  --risk-*       医学严重度语义，与品牌色互不顶替
  --brand-*      品牌身份语义（钴蓝 / 冰青 / 极光紫 / 玻璃）
  --font-*  --radius-*  --shadow-*  --motion-*  --ease

第 1 层 · 上下文别名（context alias）
  --bg --fg --fg-2 --fg-3 --hr --hr-strong
  定义在 .is-field / .is-sheet / .is-dark / .is-night / .site-head.is-invert
  组件只消费别名 → 换上下文不需要改组件

第 2 层 · 场景语境（scenario context）
  .iris2      品牌面（Brand）
  .is-admin   管理面（Management）—— 规划中，尚未实现
  .is-console 工作台面（Intelligence）—— 规划中，尚未实现
  .is-sheet   判读纸面（Clinical）
```

规则：
- **组件只消费第 1 层别名 + 场景令牌**，不直接写死第 0 层的具体色值。
- 场景类只**声明语境**（底色、文字色、面板材质），不改第 0 层。
- Portal 到 `body` 的面板**必须显式带上语境类**，否则令牌回退到根级。
- 新增令牌先问三句：**有没有语义？语义属第 0 层还是第 2 层？亮暗两套都实测过吗？**

### 3.2 双主题

- 主题切在 `<html>` 的 `.dark` 类上；`index.html` 内联脚本防 FOUC，
  `ThemeProvider` 读写 `localStorage["theme"]`，支持跟随系统。
- 翻转的是"**页面底色语境**"这一层：骨白工作台 ↔ 暗房。
- **纸面原语 `--paper-*` 不参与翻转**（§2.4）。
- 区块级 `.is-dark` / `.is-night` 是**局部反相带**，与根主题正交。
- **双主题必须传同一个品牌性格，不是简单反色**：品牌层浅色是"银蓝画布 + 白色玻璃"，
  暗色是"午夜蓝画布 + 冰蓝边缘光"，不是把浅色调暗。
- 主题相关组件必须**两种主题都验收**：4 个断点 × 2 主题逐张看。
- 主题切换**不得**重建重型渲染器（首屏光带只换参数，不重新挂载）。

### 3.3 字体

| 角色 | 令牌 | 字体栈 | 场景 |
|---|---|---|---|
| 品牌展示 / 拉丁 UI | `--font-brand` | `Manrope Variable, Manrope, Noto Sans SC, PingFang SC, …` | Brand 主用；Management 可选 |
| 衬线标题 | `--font-serif` | `Noto Serif SC, Source Han Serif SC, Songti SC, STSong, SimSun, Georgia, serif` | 全场景 |
| 拉丁展示字 | `--font-display` | `Instrument Serif, Noto Serif SC, Georgia, serif` | 保留（旧落地页用） |
| 正文 / UI | `--font-sans` | `Noto Sans SC, PingFang SC, Microsoft YaHei, Segoe UI, system-ui, sans-serif` | 全场景 |
| 数字 / 代码 | `--font-mono` | `IBM Plex Mono, JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace` | 全场景 |

原则：
- **Manrope 只覆盖拉丁字形**（可变字重 200–800，unicode-range 分片，命中拉丁约 25KB）。
  汉字按字形回退 Noto Sans SC —— **别把 Manrope 当中文兜底**。
- **衬线只用 400**，不合成加粗（700+ 与斜体一律禁止）。
- **所有数字用 `--font-mono` + `font-variant-numeric: tabular-nums`**。
- 等宽只给数据、代码、overline 与读数标签，**不用于正文**。
- 新场景引入字体前先算体积：多一套字体 = 多一次下载，值不值要写进 PR。

### 3.4 颜色与材质

**语义色板（三套，互不顶替）**

| 语义域 | 令牌 | 浅色 | 暗色 |
|---|---|---|---|
| 医学严重度 | `--risk-normal` | `#2f7d55` | `#58b183` |
| | `--risk-attention` | `#96690f` | `#cf9a37` |
| | `--risk-critical` | `#a83226` | `#d96153` |
| 临床重点 | `--signal` | `#d9541f` | `#ef7a45` |
| 品牌 | `--brand-primary` | `#2457c9` | `#85b5ff` |
| | `--brand-cyan` | `#006f82` | `#60d7e6` |
| | `--brand-aurora` | `#6b56c5` | `#c0acff` |
| 分类数据 | `--viz-series-1..6` | 见 `tokens.css` | 见 `tokens.css` |

**硬规则**
1. **严重度色与品牌色解耦**：改品牌色不动风险色，改风险色不动品牌色。
   `tokens.contrast.test.ts` 有断言：品牌色不得与风险色同值（🅿 该断言随 PR #52 加入）。
2. **颜色不是唯一信息载体**：所有状态必须同时有文字标签或第二通道
   （读数表 / 直标 / 图例 / 线型 / marker / `aria-label`）。
3. **信号橙不是主 CTA 色**（Brand / Management / Intelligence 场景例外：主 CTA 是钴蓝）。
   橙色表示"这里是重点/当前"，不表示"这里最危险"，不表示"点这里提交"。
4. **分类色只用于 Management / Intelligence 的数据图表**，不占用 `--signal` 与 `--risk-*`。
5. **禁引入第七种彩色**：彩色只能来自上表的令牌。
6. 禁纯黑 `#000` 页面背景、禁纯白页面背景、禁在浅色面上用纯黑投影。
7. **材质分层靠发丝线与明度差**；需要抬升时才用阴影，且阴影基于墨色
   （`--shadow-overlay` / `--shadow-modal`），Brand 场景的玻璃阴影用 `--brand-shadow`。

### 3.5 形状与深度

**圆角梯（只有这些值，不再写像素自由值）**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--radius-none` | `0` | Clinical 主控件默认；Management 表格与台账行 |
| `--radius-sm` | `4px` | Management 小浮层、tooltip、内嵌块 |
| `--radius-md` | `8px` | Management 下拉、弹窗、抽屉 |
| `--radius-lg` | `12px` | Management 卡片与面板；Intelligence 工作台面板 |
| `--radius-xl` | `24px` | **Brand** 大卡片、信息面板 |
| `--radius-2xl` | `38px` | **Brand** 首屏外壳容器 |
| `--radius-circle` | `50%` | 圆形：影像缩略、置信环、状态点 |
| `--radius-pill` | `999px` | 药丸标签（少数） |

> **规则已按场景拆开**（这是旧版最大的痛点）：旧规则要求"A 档主控件默认 0"，
> 同时又要求管理端像成熟 SaaS——两者只能二选一。现在：
> **Clinical 保持直角；Management 用 8–12px；Brand 用 24–38px；
> Intelligence 用 12px。** 同一组件在不同场景取不同变体，见 §4。

**深度**

| 层级 | 令牌 | 用途 |
|---|---|---|
| 0 · Flat | 无 | 页面背景 |
| 1 · Hairline | `1px solid var(--hr)` | 卡片、分隔、表格 |
| 2 · Lift | `--shadow-overlay` = `0 10px 26px rgba(20,23,26,0.09)` | 浮层、下拉、tooltip |
| 3 · Overlay | `--shadow-modal` = `0 22px 46px -32px rgba(20,23,26,0.55)` | 模态、抽屉 |

Brand 场景的玻璃面板用 `--brand-shadow`（蓝墨投影），其余场景用墨色阴影。

**焦点**

```css
:focus-visible {
  outline: 1px solid currentColor;
  outline-offset: 3px;
}
```

焦点环继承当前文字色，深浅上下文都自动成立。
**禁止**在模块里写 `outline: none` 压掉它——要改样式请提高特异度重画。

### 3.6 间距 / 栅格 / 断点

| 令牌 | 值 | 说明 |
|---|---|---|
| `--maxw` | `1240px` | 版心 |
| `--maxw`（≥2200px） | `1760px` | 超宽屏放宽 |
| `--gutter` | `40px`（超宽 56px，≤600px 时 24px） | 版心内边距 |
| `--nav-h` | `64px` | 顶栏高度 |

**断点（四档 + 超宽）**

| 档 | 宽度 | 行为 |
|---|---|---|
| 手机 | `≤ 560px` | 单列，隐藏次要读数，导航折叠为抽屉 |
| 小平板 | `560–780px` | 两列 |
| 平板 / 窄桌面 | `780–1080px` | 主栅格降列 |
| 桌面 | `≥ 1080px` | 完整版心 |
| 超宽 | `≥ 2200px` | 版心 1760，栅格摊开多栏 |

（实现里各页 `@media` 还有 17 个不同取值，见 §8。）

**场景差异**
- Brand：首屏是 `--maxw`（1240px）版心**内**的玻璃外壳容器（`--radius-2xl`），光带被裁在壳里；
  外层画布才是全幅银蓝。内容区沿用 `--maxw`。
- Management：侧边导航常驻时内容区净宽 = 版心 − 侧栏；表格优先横向空间。
- Intelligence：多面板分栏，**最小列宽**由内容决定，但任何一列不得窄于 280px
  （低于此值的证据文本必然换行到不可读）。

### 3.7 动效

**时长与缓动**：`--motion-fast: 140ms`、`--motion-base: 240ms`、
`--motion-slow: 420ms`；`--ease: cubic-bezier(0.2, 0.7, 0.2, 1)`。

| 场景 | 允许 | 禁止 |
|---|---|---|
| Clinical | 只有焦点/悬停等状态过渡，≤240ms | 装饰位移、循环动画、视差 |
| Management | 状态过渡与图表加载反馈，≤240ms | 无限循环动画、大面积入场动画 |
| Intelligence | **绑定真实运行状态**的有界动效（运行中的脉冲、事件流入、工具调用反馈） | 假进度、无事件却转动的加载环 |
| Brand | 首屏光学材质本身的运动（单渲染器）、≤12px 的入场位移、透明度 0→1 | 第二个 GPU 循环、粒子雨、滚动视差、无边界的循环背景动画 |

**全场景硬要求**
- 循环动效**不是一律禁止**——它被允许的前提是：
  **①绑定真实状态 ②有性能预算 ③离屏即停 ④页面隐藏即停
  ⑤`prefers-reduced-motion: reduce` 下当场停 ⑥用户可手动暂停（首屏已有暂停按钮）。**
- **`prefers-reduced-motion` 必须是实时订阅**，不是一次性读取：用户在运行中打开系统
  "减少动态效果"，正在跑的循环**必须当场停住**；关掉后要能恢复。
- 入场位移不超过 12px，透明度 0→1。
- 流式输出必须配 live region，**视觉动效不能替代可访问性**。
- 动效不得造成布局位移（CLS）或遮挡可点击目标。

### 3.8 可访问性

- 正文与关键标签 ≥ **4.5:1**；非文字图形 / 控件轮廓 ≥ **3:1**。
- 所有状态兼具**文字提示**；颜色不是唯一通道。
- 键盘可达、焦点可见、`:focus-visible` 全局兜底。
- 所有数字用等宽 + `tabular-nums`（读数列不错位）。
- 动效尊重 `prefers-reduced-motion`；内容在动效关闭后**完整可读**。
- 每个新页面 / 新场景交付前必须提供
  **390 / 768 / 1440 / 1920 四档 × Light/Dark 的真实浏览器截图**，
  以及一条键盘走查记录。
- 对比度不靠肉眼判断：`tokens.contrast.test.ts` 是门禁的一部分。

### 3.9 资产与第三方来源

- **只提供来源链接供设计分析**；**不得**直接把第三方概念稿截图、图标、
  独立作品图像用于线上产品。
- Iris 自有资产：金属虹膜标 `web/public/iris-mark-metallic-light.svg` / `web/public/iris-mark-metallic-dark.svg`、
  Optic Flow V4 概念图（`docs/design/assets/`）。
- **React Bits · Beams** 是 vendored 代码：必须保留**许可原文**与**固定上游 commit**，
  记录在 `web/src/components/brand/THIRD-PARTY-NOTICES.md`。
  换 SHA 必须重做逐字比对。
- **不新开特效库**：品牌特效优先复用已 vendored 的 Beams，
  细纤维用 SVG/CSS 层。**首页只允许一个正在运行的 GPU 背景。**
- 图片资产要考虑长文案、不同色彩模式与深浅主题下的可读性。

### 3.10 数据真实性

- **不虚构患者数据、AI 运行态和准确率。**
- 医学影像、结果、拒识、人工复核、免责声明、证据链**不因视觉取舍而减少**。
- 所有展示数字必须能追到后端端点与口径（全量 / 时间窗口 / 分页 / 筛选后）。
- 参考概念稿里的样例数字（营收、准确率、病例数）**不得**出现在产品里。
- **UI 不得暗示尚未实现的能力**。规划中的功能在界面上要么不出现，
  要么明确标注"规划中"。**"设计稿里有"不等于"产品里有"。**

---

## 4. 组件变体矩阵

同一套组件库，按场景取**变体**。这是本系统替代"全站方角黑按钮"单一规则的方式。

### 4.1 按钮

| | Brand | Management | Intelligence | Clinical |
|---|---|---|---|---|
| 主操作底色 | `--brand-primary` | `--brand-primary` | `--brand-primary` | `--ink`（墨色） |
| 主操作字色 | `--brand-primary-fg` | `--brand-primary-fg` | `--brand-primary-fg` | `--bg` |
| 圆角 | `--radius-pill` / `--radius-lg` | `--radius-md` | `--radius-md` | `--radius-none` |
| 高度 | 48–52px | 40–44px | 40–44px | 52px |
| 次级 | 玻璃面板 + 发丝描边 | 白底 + 发丝描边 + 极淡阴影 | 深底 + 发丝描边 | 透明底 + `--hr-strong` 描边 |
| 文字按钮 | `--brand-primary` | `--brand-primary` | `--brand-primary` | `--signal` |
| 状态反馈 | 品牌色描边 + 底部 2px 指示条 | 描边加亮 + 极淡底 | 运行态脉冲（有事件才亮） | 描边 + `--signal` 底 |
| 危险操作 | 不用品牌色 | `--risk-critical` + 文字确认 | `--risk-critical` + 文字确认 | `--risk-critical` + 文字确认 |

### 4.2 卡片 / 面板

| | Brand | Management | Intelligence | Clinical |
|---|---|---|---|---|
| 底 | `--brand-glass` / `--brand-glass-strong` | `--surface` | `--surface` / `--surface-2` | `--surface`（纸） |
| 描边 | `--brand-hairline` + 内高光 | `1px var(--hr)` | `1px var(--hr)` | `1px var(--hr)` |
| 阴影 | `--brand-shadow` | `--shadow-overlay` | `--shadow-overlay` | 无（用发丝线） |
| 圆角 | `--radius-xl`（24px） | `--radius-lg`（12px） | `--radius-lg`（12px） | `--radius-none` |
| 顶部条 | `.card-accent` 用 `--brand-primary` | `.card-accent` 用 `--signal`（当前态） | `.card-accent` 用状态语义色 | `.card-accent` 用 `--signal` |
| 嵌套 | 不多层内嵌容器 | 不多层内嵌容器 | 分区用分隔线而非套卡 | 不套卡 |

### 4.3 图表

| | Brand | Management | Intelligence | Clinical |
|---|---|---|---|---|
| 用途 | **不使用图表**（首页不装图表库） | 趋势、占比、分布、周聚合 | 事件时序、证据强度 | 八类概率尺（定长条，不是统计图） |
| 系列色 | — | `--viz-series-1..6` | `--viz-series-1..6` + 状态色 | 墨色 `--fg`（普通行）+ `--signal`（最高类）；**不用 `--risk-*`** |
| 第二通道 | — | 读数表 / 直标 / 图例 / 线型 **必选其一** | 同左 | 八类概率尺**带类别名 + 数值** |
| 口径标注 | — | **强制**：全量/窗口/分页写在标签上 | 强制 | 强制（百分比一位小数） |
| 背景 | — | `--surface` | `--surface` | 纸面 |

> 分类色板与状态色的关系：`--viz-series-*` 表达"不同的量"，
> `--risk-*` 表达"不同程度的病"。**两者不得共用一个值。**
>
> 判读记录里的**八类概率尺**更进一步：八类是**病种**，不是八种严重度，
> 所以它连分类色都不用——普通行是墨色，只有最高类那一根用信号橙。
> 严重度由页面上的 `RiskTag` 单独承担。

### 4.4 导航

| | Brand | Management | Intelligence | Clinical |
|---|---|---|---|---|
| 形态 | 顶栏药丸导航 | 常驻侧边导航 | 顶部工作区切换 + 侧栏 | 顶部简栏（无营销导航） |
| 高度 | `--nav-h` 64px | 侧栏 220–240px | 顶栏 56px + 侧栏 260px | `--nav-h` |
| 圆角 | `--radius-pill` | `--radius-md` | `--radius-md` | `--radius-none` |
| 当前态 | 药丸内嵌 + 品牌色 | 左栏 2px 品牌色指示条 + 加亮底 | 分区标题 + 状态点 | `--signal` 底部 2px |
| 移动端 | 折叠为抽屉 | 抽屉 | 抽屉 | 抽屉 |

### 4.5 弹层（统一 Base UI）

| | Brand | Management | Intelligence | Clinical |
|---|---|---|---|---|
| 形态 | 玻璃信息卡 / 模态 | 模态 / 抽屉 / 下拉 | 侧栏面板 / 模态 | 模态 / 抽屉 |
| 底 | `--brand-glass-strong` + 模糊 | `--surface` + `--shadow-modal` | `--surface` + `--shadow-modal` | `--surface`（纸） + `--shadow-modal` |
| 圆角 | `--radius-xl` | `--radius-md` | `--radius-md` | `--radius-none`（继承旧 A 档） |
| 遮罩 | 品牌色薄雾，不纯黑 | 墨色半透明，**不用纯黑** | 墨色半透明 | 墨色半透明 |
| 焦点管理 | Portal + 焦点陷阱 + `inert` + 滚动锁 + 嵌套 Esc 栈（**统一 Base UI，不手写第二套**） | 同左 | 同左 | 同左 |
| 关闭 | 显式 × + Esc | 显式 × + Esc + 点击遮罩 | 同左 | 同左 |

### 4.6 表格 / 台账

| | Brand | Management | Intelligence | Clinical |
|---|---|---|---|---|
| 是否使用 | 否 | 是（主力） | 只读事件表 | 判读记录台账 |
| 行高 | — | 紧凑，`padding-block` 撑 | 事件行更密 | 宽松，行间发丝线 |
| 斑马纹 | — | 无 | 无 | 无 |
| 排序 | — | **只在后端支持时出现**，表头 `aria-sort` | 按时间倒序（事件流） | 按时间倒序 |
| 批量操作 | — | `BatchBar`，部分失败如实回执 | 无 | 无 |
| 分页 | — | 强制，且口径写清"本页/全量" | 事件流用虚拟滚动或"加载更多" | 同 Management |

### 4.7 输入与表单

| | Brand | Management | Intelligence | Clinical |
|---|---|---|---|---|
| 输入底 | 白色/半透明 | `--surface` | `--surface-2` | 纸面 |
| 圆角 | `--radius-pill` | `--radius-md` | `--radius-md` | `--radius-none` |
| 聚焦 | 品牌色边框 + 外发光 | 品牌色边框 | 品牌色边框 | `--signal` 边框 |
| 校验 | — | 风险色 + 文字说明 | 风险色 + 文字说明 | 风险色 + 文字说明，**必填项标"待补"而非留空** |
| 标签 | — | 常驻可见 | 常驻可见 | 常驻可见 |

### 4.8 状态标记

| | Brand | Management | Intelligence | Clinical |
|---|---|---|---|---|
| 通用 | `--brand-primary` | `--signal`（当前态） | 状态语义四色（§2.3） | `--risk-*` |
| 形态 | 药丸 / 描边 | 顶部条 + 小圆点 | 状态点 + 文字 | `RiskTag`：**永远带文字、永远带小圆点、永远不整块填色** |
| 语义分离 | 不与风险色同屏 | 不与风险色同值 | 四套语义分离（§2.3） | 品牌色与风险色解耦 |

---

## 5. 不可妥协清单（任何场景、任何档位都适用）

1. **风险语义必须同时给文字标签。** 颜色不是唯一信息载体。
2. **医学措辞与免责**：所有 AI 输出配「不构成诊断结论，不能替代执业医师」。
3. **人工复核不可省略**：复核状态、复核人、复核结论、复核意见必须可追溯。
4. **证据链不可省略或降级为脚注**：模型版本、权重指纹、影像来源、工具来源。
5. **拒识（拒答）是完整结果**，不是错误状态；显示 `—` 而不是 `0`。
6. **数值口径必须写在标签上**：全量 / 时间窗口 / 分页 / 筛选后，一句话说明。
7. **登录数据隔离**：个人数据按账号 scope 隔离；换账号不得看到旧账号的任何读数。
8. **可访问性**：4.5:1 正文、3:1 图形、键盘可达、焦点可见、动效可关。
9. **性能与可访问性优先于视觉**：重型渲染必须懒加载、离屏暂停、可降级。
10. **不虚构业务能力**：后端没有的，界面不画；设计稿里的不算能力。

---

## 6. 文案与术语

- 语气：专业、克制、有同理心。不用感叹号轰炸，不用"神器/震惊"。
- **「判读」是产品动作，「诊断」是医疗行为。** 界面一律用"判读"：
  「AI 判读结果」而不是"主诊断"；「判读记录」而不是"诊断记录"；
  只有「诊断 Agent」作为产品名保留。
- 不承诺诊断结论。
- 置信度一律百分比 + 一位小数，缺省显示 `—`。
- 面向患者的解释优先于开发者读数：端点字符串、哈希、模型内部名不进主视觉。
- 品牌层的免责声明写清楚是"示意图"还是"实时结果"；
  **概念预览必须标「CONCEPT PREVIEW · 非实时结果」**。

---

## 7. 实现状态总表

| 能力 | 状态 | 依据 |
|---|---|---|
| 品牌令牌 `--brand-*` / `--font-brand` / `--radius-xl` / `--radius-2xl` / `.iris2` | 🅿 | PR #52（`ui` 上尚未存在） |
| 首屏光学主视觉（WebGL2 Beams + SVG 纤维 + 静态降级 + 暂停） | 🅿 | PR #52 `OpticFlow.tsx` / `beamsMount.ts` |
| 首屏品牌排版（眉线 / Manrope 标题 / 双 CTA / 玻璃流程卡 / 三张入口卡 / 仪器读数条 / 免责条） | 🅿 | PR #52 `LandingHero.tsx` |
| 品牌层对比度断言 | 🅿 | PR #52 `tokens.contrast.test.ts` |
| 管理端 7 个页面 + TanStack Query/Table + Recharts + Base UI 弹层 | ✅ | `web/src/pages/admin/` |
| 临床判读链路（诊断 / 记录 / 记录纸 / 风险标记 / 免责） | ✅ | `web/src/components/RecordSheet.tsx` 等 |
| 首页下半页各区块（影像示意 / 样本 / 流程 / 判读记录 / Agent / 边界 / 行动） | ✅ | `web/src/pages/LandingPage.tsx`（旧语境） |
| Agent 单会话问答 + SSE（assistant/reasoning/tool-request/tool-response/confirm） | ✅ | `web/src/lib/agentStream.ts` |
| 会话身份竞态防护（epoch 顺序 + 按账号 scope 隔离） | 🅿 | PR #52 `web/src/lib/session.tsx` |
| 品牌导航药丸化 / 首页下半页统一到 `--brand-*` | 🗓 | 首页二期，路线图 R2 |
| 管理端视觉升级（圆角 8–12px、实体卡片、钴蓝主操作、深海蓝暗底） | 🗓 | 路线图 R3 |
| 多 Agent 协作视图 / 影像工作台 / 证据区 | 🗓 | 后端协议未定义，路线图 R4 |
| 第三方概念稿中的任何界面 | ◌ | **不是**产品能力，不应被描述成已实现 |

---

## 8. 已知偏差与技术债

写在这里，是为了让下一个读者知道"这不是设计意图，是待修的问题"，而不是照着它复刻。

| 问题 | 影响 | 处置 |
|---|---|---|
| ~~`--fg-3` 在 `--field` 上约 2.89:1，低于 AA 4.5:1~~（**已修 2026-11-10 批次**：三级文字提到 `--paper-ink-3: #676e72`，`--field` 上 4.7:1、`--surface` 上 5.2:1） | **残留**：在 `--surface-2`（4.32:1）与 `--surface-3`（3.96:1）上三级文字仍不达标 | 抬到 ≥4.5，或规定三级文字不落在这两级抬升面上 |
| Tailwind v4 的 `.overline` 给每个眉线标签多加一条上划线 | 全站眉线，深色面上尤其脏 | 应用规则加 `text-decoration-line: none` 或改名 |
| ~~上下文令牌未在 `:root` 兜底~~ | 固定层组件回退 `currentColor` | **已修（2026-11-11）** |
| 红绿色盲下"关注"与"高"几乎同色 | 只能靠文字标签区分 | 保持文字标签强制 |
| ~~`highlight.js` 全量打包~~ | markdown 块曾达 1,019KB | **已修（2026-11-11）**，降到 186KB |
| Tailwind v4 全量引入，实际只用到 1 个工具类（`overline`，markup 里 18 处），而它正是相邻那行缺陷的成因 | 体积成本，且自带缺陷 | 盘清被依赖的 reset 后移除，或改名避开冲突 |
| 仍有 3 处 `outline: none`：`CardSwap.css` 的装饰容器、`admin.css` 里 Recharts 图表 wrapper 的 `:focus`、`app.css` 的账号菜单面板 | 前两处是装饰/弹层容器（焦点不在其上），**Recharts wrapper 那处会让图表聚焦时没有可见焦点环** | 逐处提高特异度重画，不要删焦点；装饰性的两处可留并写明理由 |
| 断点未完全收敛：各页 `@media` 共有 17 个不同取值（520/560/600/640/680/700/720/760/768/780/800/860/900/980/1080/1700/2200） | 各页断点行为不一致 | 新代码只用 §3.6 五档 |
| 品牌层只覆盖首页首屏与其外壳 | 首页下半部分仍走旧的骨白/暗房语境，两套底色同页共存 | 首页二期统一到 `--brand-*`；旧语境不强制迁移 |
| 首屏光带参数是手调的，不是从设计稿反推的 | 换分辨率 / DPR 下观感可能不如预期 | 390/768/1440/1920 × 亮暗逐张看过；改配色需重看 |
| `--brand-*` 令牌与 `.iris2` 只存在于 PR #52，尚未进入 `ui` | 在本分支上写品牌组件会取不到令牌 | 合并 PR #52 后再开发；本文已按"已实现"口径写，但**代码事实以 `tokens.css` 为准** |
| 管理端仍是旧 B 档外观（0 圆角、墨色主按钮） | 与 §2.2 目标不一致 | 路线图 R3 |
| Intelligence 场景的后端事件协议未定义 | 协作区无法实现 | 先定协议再画界面，**不许先画假状态** |

---

## 附录 A · 速查卡

```
品牌层      --brand-primary #2457c9（暗底 #85b5ff）/ --brand-cyan / --brand-aurora
            仅 .iris2 语境（Brand 场景）；信号橙仍是临床语义色，两者不混用
品牌字体    --font-brand（Manrope Variable → Noto Sans SC 回退）

页面底      --field         #f3f4f1        （暗底 --night-bg #0b0d0c）
纸面        --surface       #ffffff        （判读纸任何主题都不变）
主文字      --ink           #14171a        次要 --ink-2 #5c6367   注释 --ink-3 #676e72
发丝线      --line          rgba(20,23,26,.13)

临床重点    --signal        #d9541f（暗底 #ef7a45）  —— 焦点/当前态，不是主 CTA
风险        --risk-normal #2f7d55 / --risk-attention #96690f / --risk-critical #a83226
            永远同时给文字标签
分类色      --viz-series-1..6（仅 Management / Intelligence 图表，浅/暗两套）

标题        --font-serif（Noto Serif SC 栈），weight 400
正文        --font-sans
数字        --font-mono + tabular-nums

圆角        Clinical 0 / Management 8–12px / Intelligence 12px / Brand 24–38px
            令牌：--radius-none/sm/md/lg/xl/2xl/circle/pill
阴影        --shadow-overlay（浮层）/ --shadow-modal（模态）/ --brand-shadow（品牌玻璃）
版心        1240px；≥2200px 时 1760px
动效        --motion-fast 140ms / --motion-base 240ms / --motion-slow 420ms
真源        web/src/styles/tokens.css（已实现的事实）
            本文（目标规范）；差异见 §8 与 docs/design/iris-2-rule-change-matrix.md
```

**写组件前先问四句**：
这里需要颜色吗（默认中性）？这个数字是量化数据吗（是就用 mono）？
这是纸还是底（纸永远是纸）？**这个场景是 Brand / Management / Intelligence / Clinical
里的哪一个（决定圆角、主色与动效预算）？**

---

## 附录 B · 参考来源

以下链接仅供设计分析；**第三方作品是灵感，不是可复制模板**；
其截图、图标与独立作品图像不得进入产品。

| 代号 | 参考 | 链接 |
|---|---|---|
| A | Iris Optic Flow V4 首页概念（**自有资产**） | `docs/design/assets/optic-flow-v4-light.png` / `-dark.png` / `optic-flow-v4.html` |
| B | Axion · Clean Corporate Website for Life Sciences | https://dribbble.com/shots/27206008-Axion-Clean-Corporate-Website-for-Life-Sciences |
| F | Cure.Med · Medical Platform Branding and Dashboard Concept | https://dribbble.com/shots/24203305-Cure-Med-Medical-Platform-Branding-and-Dashboard-Concept-SaaS |
| G | Healthcare Dashboard Design（Clinical AI） | https://dribbble.com/shots/27302963-Healthcare-Dashboard-Design |
| H | MediCore AI · Healthcare Command Center UI | https://dribbble.com/shots/27363076-MediCore-AI-Healthcare-Command-Center-UI |
| I | Synthia OS · AI-Powered Biotech & Gene Synthesis（**信息布局参考，非眼科**） | https://www.behance.net/gallery/250063917/Synthia-OS-AI-Powered-Biotech-Gene-Synthesis |
| 影像工作流 | V7 Darwin · Medical Imaging Annotation | https://www.v7darwin.com/medical-imaging-annotation |
| 动态材质 | React Bits · Beams（vendored，见 `THIRD-PARTY-NOTICES.md`） | https://reactbits.dev/backgrounds/beams |

访问日期：2026-11-12。
完整的取舍说明（"只借鉴什么 / 不照搬什么"）见
`docs/design/IRIS_2_DESIGN_REFERENCE_BRIEF.md` §1。

# Iris 2.0 · Adaptive Visual System — Design Reference Brief

> **入库说明（2026-11-12）**：本文件是 Iris 2.0 设计升级的**外部参考简报**，
> 按交接要求原样入库，供后续开发者查阅视觉来源与取舍。
> **它不是规范真源**——规范真源是仓库根 `DESIGN.md`（目标）与
> `web/src/styles/tokens.css`（已实现的事实）；实施顺序见
> `iris-2-implementation-roadmap.md`，规则变更对照见 `iris-2-rule-change-matrix.md`。
> 简报里的代号（A/B/F/G/H/I）是**参考设计代号**，不是仓库组件或 CSS 变量。
> 简报正文保持原样入库；正文里「PR #52 head `22b159d`」是**编制当时**的快照，
> 入库时 PR #52 的 head 已推进到 `5194f10`（含首屏 WebGL 生命周期与会话身份竞态修订），
> 以 `git rev-parse feat/iris-2-optic-flow` 为准。
> 第三方作品只作灵感，其截图与图标不得进入产品；Iris 自有资产见 `assets/`。

> **交给 Coding Agent 的独立参考资料** · 2026-11-12  
> **适用仓库**：`yuwen773/eyes-diagnosis` · 正式 React 前端 `web/`（废弃 Vue `frontend/` 不参与本轮）。  
> **现有工程起点**：`ui@4039ad7`；首页品牌实现处于 **PR #52**（head `22b159d`，base `ui`，本文件编制时尚未合并）。执行前务必重新检查 GitHub 最新状态。  
> **首要提醒**：A/B/F/G/H/I 是讨论阶段的**参考设计代号**，**不是**仓库组件、技术框架或 CSS 变量；下文定义其精确含义。**不要要求 Coding Agent 自己猜测代号。**

## 0. 设计目标与边界

**品牌主题**：Intelligent Vision, Beautifully Clear. / 智能视觉，清晰呈现。  
**已选择主色体系**：钴蓝（科技品牌）× 冰川银蓝（光学材质）× 少量靛蓝极光（AI 智能表达）。  
**已选择三种产品场景**：品牌首页、管理后台、AI Agent 协作与医学影像工作台。  
**产品原则**：医疗准确性、风险语义、人工复核、可追溯证据、登录数据隔离、性能及可访问性优先；视觉可大胆，但不能牺牲真实内容。  
**交付边界**：本文用于撰写全站设计标准及后续分阶段研发，并不意味着 F/G/H/I 已开发完成。当前只确认 PR #52 的首页首期实现。

## 1. 原设计代号逐一定义（含可打开的原始来源）

| 代号 | 原始参考 | 参考来源 | 只借鉴的设计特征 | 不应照搬 |
|---|---|---|---|---|
| **A · Aqua Flow / 液态光学玻璃** | **已获得认可的 Iris Optic Flow V4 首页概念** | 本交接包 `assets/optic-flow-v4-light.png`、`assets/optic-flow-v4-dark.png`；`assets/optic-flow-v4.html`；已实现 PR #52 截图 `docs/assets/iris2/hero-1440-light.jpg` / `hero-1440-dark.jpg` | 银灰空间、连续玻璃光带、蓝青高光、大字体、悬浮轻质卡、开阔留白；**Light/Dark 均成立** | 他人图片、不可复核医学数字；不能将 SVG 概念图声称为实时 WebGL/3D |
| **B · Blue Lab / 钴蓝生命科学** | Axion · Clean Corporate Website for Life Sciences | https://dribbble.com/shots/27206008-Axion-Clean-Corporate-Website-for-Life-Sciences | 钴蓝作为主强调、冷静的模块化构图、清爽科技感与层次、明亮科技公司气质 | 不照搬完整首页、品牌标识、文案、视觉图像与商标 |
| **F · Violet Clinical / 现代医疗 SaaS** | Cure.Med · Medical Platform Branding and Dashboard Concept | https://dribbble.com/shots/24203305-Cure-Med-Medical-Platform-Branding-and-Dashboard-Concept-SaaS | 成熟 SaaS 信息架构、舒适卡片层级、适度圆角、侧边导航、任务导向的数据组织 | 不复制其预约/CRM 业务字段到眼科项目，不继承其完整紫色品牌 |
| **G · Clinical AI / 智能数据台** | Healthcare Dashboard Design（Clinical AI） | https://dribbble.com/shots/27302963-Healthcare-Dashboard-Design | 清晰的 KPI、AI 功能重点卡、多类型可视化、可读的指标分区、温和的动效和视觉层次 | 不采用概念稿虚构指标（如不相关的营收）、未经证实的诊断数据 |
| **H · AI Command / 实时 AI 指挥台** | MediCore AI · Healthcare Command Center UI | https://dribbble.com/shots/27363076-MediCore-AI-Healthcare-Command-Center-UI | 深色指挥台、运行状态、实时任务优先级、事件流、分栏和可视化反馈 | 不复制心脏扫描、生命体征、急诊队列，也不能虚构后端未实际产生的 Agent 活动 |
| **I · Imaging Workspace / 医学影像工作空间** | Synthia OS · AI-Powered Biotech & Gene Synthesis（**概念性信息布局参考**） | https://www.behance.net/gallery/250063917/Synthia-OS-AI-Powered-Biotech-Gene-Synthesis | 多面板信息密度、深色观察区、主影像/主任务优先、上下文侧栏、双主题专业工作台 | **不是眼科产品**，不复制基因合成领域业务术语、3D 生物模型与实验流程 |

**眼科影像交互补充参考**：V7 Darwin 医学影像查看与标注流程，https://www.v7darwin.com/medical-imaging-annotation 。这个来源是工作流参考，不是用来确定 Iris 品牌配色。

**动态材质来源**：React Bits · Beams，https://reactbits.dev/backgrounds/beams ；背景目录 https://www.reactbits.dev/c/backgrounds 。Ghost Fibers 只借鉴“细纤维”视觉语义，**不要求再开启第二个 WebGL 渲染器**。

**参考优先级**：Iris 自有 V4 与真实产品业务 > 本设计简报 > 第三方概念稿。第三方作品是灵感，不是复制模板。无法访问来源时仍必须以本简报的设计规则为准，注明未亲眼验证的细节。

## 2. 三种场景的最终组合（不再写代号交给 Agent 猜）

### 2.1 Brand Experience — 首页与品牌落地页（此前 A + B）

- **目标气质**：精致、清透、大胆、科技感和空间感；不是仪器说明书，也不是粒子炫技页。
- **主视觉**：一个连续、具有厚度与明暗高光的蓝青光学带，内部少量细密纤维；右侧/中部有空间纵深；大号 Manrope 英文排版与清晰中文副标题。
- **首页布局**：清爽品牌导航 → 大标题/副标题与清晰双 CTA → 单主视觉 → 玻璃信息卡 → 产品入口 → 真实医学产品展示与免责声明。
- **Light**：`#F2F6FC` 银蓝画布、白色/半透明面板、钴蓝正文强调、冰青反射，玻璃感通透而非灰蒙。
- **Dark**：`#0B1425` 午夜蓝画布、`#17263D` 深蓝表面、冰蓝边缘光、很少量紫色反射；不能用纯黑+过度霓虹。
- **动效**：首屏一个 WebGL2 渲染器；细纤维用 SVG/CSS；低端、reduced-motion、WebGL 缺失、上下文丢失有高质量静态/冻结回退；提供暂停控制。
- **当前实现**：PR #52 的 `LandingHero.tsx`、`OpticFlow.tsx`、`web/src/styles/brand.css`；后续任何调整都先对照该 PR 的真实截图，禁止无理由推翻已有布局。
- **不要做**：多 GPU 背景叠加；把三维材质压在主要文字上；无关患者图/虚构医学数字。

### 2.2 Management Experience — 管理后台（此前 F + G）

- **目标气质**：成熟医疗 SaaS，柔和但不软弱，功能优先、数据可读、可操作性强；强调“管理与行动”，不是照搬首页的 3D/玻璃视觉。
- **结构**：稳定的侧边导航 + 位置/上下文标题区 + 关键 KPI + 任务状态/待办 + 趋势图 + 筛选表格 + 详情弹层。
- **视觉层次**：清晰的背景、实体卡片、必要且适度的圆角和阴影；卡片间距有规律，不堆多重内嵌容器；允许合理的数据系列配色和图表图例。
- **Light**：冷白/浅蓝灰背景、白卡、钴蓝主要操作、低饱和青/紫分类色；卡片与画布分层清晰。
- **Dark**：深海蓝背景与分层面板，图表系列亮度单独调整；浅色文字与指标必须满足对比度；不会把所有 KPI 都渲染为发光渐变色。
- **业务优先级**：用户管理、眼底判读管理、人工复核队列、知识库失败项、新闻审核、数据分析；只展示后端有依据的数据，区别全量、时间窗口、分页口径。
- **复用技术**：TanStack Query + TanStack Table + Recharts + Base UI/shadcn；不得因为要实现设计稿而自研排序、焦点陷阱、Dialog、复杂图表绘制。
- **不要做**：虚构 KPI；一个 Tab 展示 30d，卡片保留 7d 旧缓存却不提示；图表只通过颜色区分；把首页 Beams 直接铺满管理页面。
- **开发状态**：F+G 是**下一阶段的目标规范**，不是 PR #52 的已交付成果。

### 2.3 Intelligence Experience — 多 Agent 协作与眼科影像判读工作台（此前 H + I）

- **目标气质**：专业影像工作区 + 真实 AI 多智能体协作。需要“看到协作”，而不只是聊天框或一条假进度条。
- **核心布局建议**：
  - 主区：眼底影像、双眼对比、标注/疑点、缩放、影像质量提示；主画布在任意主题下使用稳定中性深色以便观察影像。
  - 协作区：按后端真实事件呈现 Agent 节点、状态（等待/执行/完成/失败/待人工确认）、工具调用、时序与任务依赖。
  - 证据区：模型版本、工具来源、影像来源、引用/检索证据、置信度及限制、人工复核和结果来源，明确不构成临床诊断结论。
  - 对话区：保留问答交互，但应为协作工作台的一个子区域，而非全屏唯一内容。
- **Light**：浅色操作框架 + 中性深色影像画布；证据与 Agent 卡片可用淡蓝、冰青、局部紫色区分层次。
- **Dark**：深蓝/深石墨框架 + 稳定深色影像区，微弱发光仅用于运行态，保证病变区域和标注清晰。
- **状态语义**：运行态（品牌蓝/青）、智能体类别（允许局部紫）、待人工复核（独立审查状态）、临床病情严重度（只能用独立 `--risk-*` 语义），不得混淆。
- **数据真伪要求**：只展示实际 Spring AI Alibaba / 后端协作事件；流式事件协议尚未完整提供时，在设计规范中列明事件字段需求，不得在产品里假装实时 Agent 调用。
- **技术原则**：优先扩展现有 agentStream 事件/协议，必要时约定 `runId`, `agentId`, `stepId`, `status`, `tool`, `evidenceRef`, `timestamp`；这是目标接口建议，不得擅自改后端或声称已实现。
- **不要做**：用虚假 Agent 卡片冒充正在执行；“高风险”用紫色品牌渐变代替临床警示；为了沉浸感盖住影像或降低可读性。
- **开发状态**：H+I 是**下一阶段目标规范**，不是 PR #52 已交付成果。

### 2.4 Clinical Experience — 诊断记录、人工复核、医疗判读

保留专业准确性与中性影像显示背景；没有必要强制所有控件方角、所有页面信号橙。医疗风险语义、拒识、待复核、模型版本、证据链、人工签字、免责、数值口径和可访问性是不可妥协约束。主诊断与 AI 辅助判读不能混为一谈。

## 3. 跨场景统一的 Brand Tokens（PR #52 现有值，设计阶段可审议，不应不经验证随意覆盖）

| 语义 Token | Light | Dark |
|---|---|---|
| `--brand-canvas` | `#f2f6fc` | `#0b1425` |
| `--brand-surface` | `#ffffff` | `#17263d` |
| `--brand-text` | `#16233a` | `#eff6ff` |
| `--brand-muted` | `#5b6b82` | `#a9bbd3` |
| `--brand-primary` | `#2457c9` | `#85b5ff` |
| `--brand-primary-fg` | `#ffffff` | `#0b1425` |
| `--brand-cyan` | `#006f82` | `#60d7e6` |
| `--brand-aurora` | `#6b56c5` | `#c0acff` |

统一使用现有 `ThemeProvider`，主题选择器 `html.dark`，支持系统主题。Manrope 主导拉丁品牌与 UI 文本，Noto Sans SC 负责中文，IBM Plex Mono 负责程序/技术读数。Logo 沿用项目现有金属虹膜标 `iris-mark-metallic-light/dark.svg`（具体文件路径以仓库实际位置为准）。

**统一的是品牌身份、基本排版、语义色、按钮反馈、可访问性和交互逻辑；不同的是页面密度、视觉强度、面板材质与布局。** 不要求三大场景都长成同一种卡片布局。

## 4. 设计实现优先级与不可违反的标准

- **基线顺序**：先完成 PR #52 工程验收与修复 → 规范文档合并 → 首页二期的统一 → 管理端 F+G → Agent/影像 H+I。不要一次性全面翻新。
- **文档真源**：将 `DESIGN.md` 从旧白色仪器总纲升级到 Iris 2.0 Adaptive Visual System；保留现有已验证的医疗规则、Token 和工程注释；`CLAUDE.md` 只放简明索引及执行原则，避免双重真源。
- **视觉复用**：Base UI/shadcn（弹层和基础交互）、TanStack Query（服务端状态）、TanStack Table（表格数据）、Recharts（可视化）、React Bits（品牌特效）优先；不得重造已有基础设施。
- **无重复背景**：首页只允许一个正在运行的 GPU 背景；边缘纤维可用低成本 SVG；否则给静态回退。
- **对比度**：普通正文/关键标签最少 4.5:1；非文字图形/控件轮廓最低 3:1；所有状态兼具文字提示；键盘焦点明确。
- **主题和响应式**：同一组件 Light/Dark；至少 390/768/1440/1920 四档实际浏览器截图；处理长文案、图片和色彩切换；兼容 `prefers-reduced-motion`。
- **业务真实性**：不虚构患者数据、AI 运行态和准确率。医学影像、结果、拒识、人工复核、免责声明、证据链不因视觉取舍而减少。
- **文档准确性**：明确区分已经实现 / 在 PR 中 / 规划中 / 仅示意；不要把 Dribbble、Behance 概念稿称为可直接复用的前端源码。
- **外部资源**：仅提供来源链接供设计分析；不得直接将第三方概念稿截图、图标、独立作品图像用于线上产品。React Bits 的使用需保留许可原文和固定上游 commit。

## 5. DESIGN.md 文档重构任务的验收标准

1. 全站最高理念不再是 `The White Instrument`，新版标题为 `Iris 2.0 · Adaptive Visual System`；旧理念只作为临床阅读的历史设计背景保留（如确有意义）。
2. 消除文本冲突，例如首页允许品牌渐变，却在开头禁止一切渐变；Agent 需要有界动效，却在后文一律禁止循环动效；管理后台需要成熟 SaaS 卡片，却一律要求方角。
3. 三大场景各有：目标气质、页面结构、Light/Dark、字体、颜色与材质、组件复用、真实业务约束、反例、当前完成状态。
4. 给出组件变体矩阵（Brand / Admin / Agent / Clinical），按钮/卡片/图表/导航/弹层不能只写一个全站通用的“方角黑按钮”。
5. 统一并明确优先级：`tokens.css` 是已实现的令牌事实，`DESIGN.md` 是目标规范；两者有不一致时，先标记迁移差异，不要声称已经落地。
6. 保存现有医学安全与数据边界规则，并要求新增页面以实际截图和交互回归验收。
7. **本 PR 仅修改设计文档与必要的 `CLAUDE.md` 索引**；不借文档重构之名大范围改组件、不改后端、不开新特效、不合并部署。

## 6. 可直接复制给 Coding Agent 的执行指令

> 请先阅读交接包中的 `IRIS_2_DESIGN_REFERENCE_BRIEF.md` 与 `assets/` 图像，再审查项目 `DESIGN.md`、`CLAUDE.md`、`web/src/styles/tokens.css` 和 PR #52。A/B/F/G/H/I 是**参考代号**，具体含义与链接都写在本简报第 1 节；不得脱离此简报猜测或泛化。请将全站设计规范重构为 `Iris 2.0 · Adaptive Visual System`，按 Brand（已实现首期）、Management（规划 F+G）、Intelligence（规划 H+I）、Clinical（保留医学专业规则）拆分视觉章节；统一双主题、字体、颜色、组件复用和医学安全/可访问性标准。先给出旧规则冲突矩阵与新文档目录，再进行文档修改；只提交设计文档与必要索引，禁止擅自重构页面、修改 API、合并 PR 或部署。对任何无法访问的来源，不编造图片内容，以本简报文字规则与 Iris 自有设计稿为准。

---

**建议放入仓库的位置**：`docs/design/IRIS_2_DESIGN_REFERENCE_BRIEF.md`，图片放在 `docs/design/assets/`。在 `DESIGN.md` 顶部加入链接。保留第三方来源 URL 与访问日期，但不用直接复制他人的整套设计。

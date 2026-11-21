# Iris 2.0 · R2.5 全站产品体验统一 · 现状审计与实施方案

> **状态**：R2.5-00 交付物（审计 + 方案 + 规范修订同批）。
> **基线**：R2 栈 tip `3d8598e`（PR #59 分支）+ PR #53 的 `DESIGN.md`（合并提交见本分支）。
> **本文件不重开 R2 已关闭的整改循环**：R2-00～R2-04 的玻璃材质、光带、胶囊顶栏、
> 深海蓝页脚与首页整页作用域均已实现并通过独立审查；本文只处理 R2 未覆盖的
> **跨路由产品连续性**。
>
> 证据目录：`docs/assets/iris2/r25/before/`（真实浏览器截图，2026-11-13）。
> 截图方法：Playwright + Chromium 1234（headless，SwiftShader），本地真实后端
> （Spring Boot :8081 + MySQL）与 R2 工作树 Vite :5174；`/profile`、`/records`、
> `/agent` 使用一个临时账号取得真实登录态，截图后已删除该账号，不入库、不写口令。

---

## 0. 一句话结论

**品牌身份已统一到 Logo 与令牌层，但「产品外壳」没有统一。**

- 全站已经共用金属虹膜标、Manrope、钴蓝令牌与双主题；
- 但公开路由分成两套**互不相关的顶栏实现**：`BrandHeader`（首页/新闻）与
  `SiteHeader`（判读/Agent/个人中心/记录），结构、字体、当前态、按钮语言都不同；
- 新闻虽已换 `BrandHeader`，页面主体仍是仪器台账；
- 首页 Hero 之后仍是旧仪器版式；
- 结果就是任务书所说的「跨路由视觉断层」：从首页点「判读」会像进了另一个产品。

R2.5 的目标不是把所有页面涂成玻璃，而是建立 **Shared Product Shell**：
**同一套品牌导航结构 + 按场景变化的材质强度与内容版式。**

---

## 1. 审计范围与方法

### 1.1 路由清单（对照 `web/src/App.tsx`）

| 路由 | 页面 | 场景 | 当前 Header | 当前 Footer | 根语境类 |
|---|---|---|---|---|---|
| `/` | `LandingPage` | Brand | `BrandHeader` | `BrandFooter` | `.is-field .night .is-brand-page` |
| `/news` | `NewsPage` | Brand（应为 Editorial） | `BrandHeader` | 无（只有 `DisclaimerBar`） | `.is-field` |
| `/news/:id` | `NewsDetailPage` | Brand（应为 Editorial） | `BrandHeader` | 无（只有 `DisclaimerBar`） | `.is-field` |
| `/diagnosis` | `DiagnosisPage` | Clinical | `SiteHeader` | 无（`DisclaimerBar`） | `.is-field` |
| `/records` | `RecordsPage` | Clinical | `SiteHeader` | 无（`DisclaimerBar`） | `.is-field` |
| `/profile` | `ProfilePage` | Clinical | `SiteHeader` | 无（`DisclaimerBar`） | `.is-field` |
| `/agent` | `AgentPage` | Intelligence | `SiteHeader` | 无（工作区铺满视口） | `.is-field` |
| `/login` | `LoginPage` | Brand（入口） | 无 | 无 | `.is-dark` / `.is-field.auth--light` |
| `/register` | `RegisterPage` | Brand（入口） | 无 | 无 | 同上 |
| `/admin/*` | 7 页 | Management | 独立侧栏 | 错误页 `SiteFooter` | `.is-field` |

### 1.2 审计动作

1. 逐路由在 1440 / 390 两档、Light / Dark 两主题实拍；
2. 记录页面根类、Header 类、Header 计算底色、主导航类、Footer 类、横向滚动；
3. 滚动整页让 `ScrollExpand` 等懒挂载区块真正渲染后逐区截图；
4. 登录后复拍 `/profile`、`/records`、`/agent`；
5. 对照 `DESIGN.md` §1.5 / §2 / §4 / §5 与 `tokens.css` 真值判定差异。

**Console 错误**：32 次路由捕获中 0 条 console error / pageerror。
（Agent 的 SSE 业务失败不在本次审计范围，R2 交接已记录 DashScope 401 的环境限制。）

---

## 2. 全站不一致清单（按影响排序）

### 2.1 P0 · 顶栏是两套实现，跨路由直接换产品

| 维度 | `BrandHeader` | `SiteHeader` |
|---|---|---|
| 结构 | 字标 + **中央悬浮胶囊** + 主题/账号/主 CTA/汉堡 | 字标 + 竖线 + **右侧平铺链接** + 主题/账号/汉堡 |
| 字体 | `--font-brand`（Manrope）13.5px | `--font-sans` 13px |
| 当前态 | 实心钴蓝胶囊 | 下划线（`--signal`） |
| 主 CTA | 钴蓝胶囊「开始判读 ↗」 | 无；未登录是墨色实心「登录」 |
| 背景 | 悬浮、与画布之间无硬边 | 通栏实底 + 1px 下边线 |
| 高低 | 56px 内胆、8/6px 上下留白 | `--nav-h`（64px） |
| 移动端 | ≤900px 收胶囊，801–900 显示汉堡 | ≤800px 收链接 |

**重复逻辑**：路由变化重挂、主题切换按钮 SVG、`AccountMenu`、`MobileNav`、
`NAV_LINKS`、字标渲染在两边各写一遍。R2-02 刻意用「独立类名」避免全站被动改样，
这条约束在 R2 阶段是对的；R2.5 要统一时，必须**主动**把两套收敛成一套，
而不是让任何一页继续意外继承旧样。

**证据**：`before-landing-1440-*.jpg` vs `before-diagnosis-1440-*.jpg`、
`before-news-1440-*.jpg` vs `before-agent-1440-*.jpg`。

### 2.2 P0 · 新闻页「顶栏是品牌层，身体是仪器台账」

- 根语境仍是 `.is-field`，Header 底色被算成 `rgb(243,244,241)`（骨白），
  而首页 Header 底色是 `rgb(242,246,252)`（品牌画布）——同一组件、两种底色。
- 页面主体：超大衬线标题 + **四列读数条**（条目 / 页码 / 最新 / 本页影像）+
  方形检索框 + 信号橙角标卡片。它读起来像一台仪器在报数，而不是资讯门户。
- 本地真实数据 13 条、全部无封面；每张卡用「空框 + 正文开头」占位，
  三列等高卡片把短讯也撑成海报尺寸。
- 没有精选层次、没有明确的日期分组、没有页脚。

### 2.3 P0 · 首页 Hero 之后仍是旧仪器版式

- Hero 是品牌玻璃 + 光学画布；下面的 `plate / specimen / how / record /
  agent / bounds / start` 仍是骨白仪器台的语言：居中图片、衬线大标题、
  发丝线表格、`.card-accent`、信号橙读数。
- R2-04 只换了整页画布与发丝线（`.is-brand-page`），**没有改区块构图**；
  所以底色连续了，版式仍然断层。
- `record` 区展示的是真实判读记录样式（`RecordSheet`）：**纸面语义必须保留**，
  但它应该被品牌层「陈列」而不是直接平铺成一张表格。

### 2.4 P1 · 判读页没有「工作区」，只有「旧仪器台 + 上传槽」

- 顶栏是旧的；步骤条（影像/判读/记录）、列头、`STANDBY` 读数全是仪器语言；
- 上传槽本身是好的（分划板、真实影像、质量门提示），但主任务与右侧读数
  没有形成清晰的「上传 → 判读 → 记录」工作区层次；
- 结果页直接 `SectionHead + RecordSheet`，缺少结果容器与操作层次；
- **医学安全资产完整**：质量门、拒识、人工复核、模型版本、权重指纹、
  免责条都在，R2.5 一条都不能删或降级。

### 2.5 P1 · Agent 是旧仪器欢迎屏，不是会话工作区

- 欢迎屏：信号橙线稿眼睛 + 衬线「Iris」+ 三张旧卡片；
- 左侧会话栏、顶部状态、输入条各自为政，视觉层级只有「边框 + 小字」；
- 工具消息、推理消息、资源面板已经存在（R2 之前已实现），但缺少统一的
  消息层次与运行态表达；
- 后端目前只有**单会话问答 + SSE 事件**，没有多 Agent 节点/任务依赖协议。
  R2.5 只升级真实存在的界面，**不虚构协作节点、不画假执行状态**。

### 2.6 P1 · 个人中心 / 记录页的「大标题 + 四列 KPI」压过内容

- 两页都以超大衬线标题 + 四列读数条开场（记录页更甚），个人中心还把
  「注册时间」「角色」放进与「判读总数」同权的读数条；
- 旧顶栏 + 墨色主按钮 + 方角表单，与品牌层完全没有共同语言；
- 数据隔离、统计口径、复诊申请、记录纸展开都是真实能力，必须保留；
- `/records` 是全站唯一合法的「KPI + 台账」临床页，骨架可以不改，
  但标题尺度、顶栏、按钮与间距要收敛。

### 2.7 P2 · 页脚策略不统一

| 页面 | 现状 | 问题 |
|---|---|---|
| `/` | `BrandFooter`（完整三层） | 正确 |
| `/news`、`/news/:id` | 无页脚，只有 `DisclaimerBar` | 门户页没有收尾 |
| `/diagnosis` | 无页脚，只有 `DisclaimerBar` | 工作区可接受 |
| `/records`、`/profile` | 无页脚，只有 `DisclaimerBar` | 资料页可接受 |
| `/agent` | 无页脚 | 工作区应铺满，正确 |
| 管理端错误页 | `SiteFooter` | 管理端独立，保持 |

### 2.8 P2 · 断点与触控目标的历史债

- 全站 `@media` 仍有 17 个取值；R2 只收敛了品牌顶栏这一块；
- R2.5 新增/改写的样式只用 `--nav-h` 与 390 / 768 / 820 / 900 / 1440 / 1920 六档；
- 品牌顶栏触控目标已 ≥44px；临床旧顶栏的链接仍靠行高撑，迁移时一并达到 44px。

---

## 3. 样式关系判定

### 3.1 `.is-field` / `.night` / `.is-night` / `.iris2` / `.is-brand-page`

| 类 | 作用 | R2.5 处置 |
|---|---|---|
| `.is-field` | 骨白工作台上下文；定义 `--fg/--bg/--hr` | 保留。Clinical / Intelligence 继续用它 |
| `.night` / `.is-night` | 暗房底 + 暗色令牌映射 | 保留给认证页与需要局部反相的区块；不再作为公开页的默认外壳 |
| `.iris2` | **品牌视觉容器**，只声明「这一块是品牌面」 | 保持「只在首页首屏」的约束；不等于「用品牌色的开关」 |
| `.is-brand-page` | 整页画布/发丝线换成品牌值，不动文字与临床语义 | 扩展为**公开品牌页的共享画布**：首页 + 新闻（Editorial） |

### 3.2 哪些旧规则是临床安全约束，哪些只是历史外观

| 旧规则 | 性质 | R2.5 结论 |
|---|---|---|
| `RecordSheet` 白纸、纸面原语不随主题翻转 | **安全约束** | 原样保留 |
| `RiskTag` 文字 + 圆点、不整块填色 | **安全约束** | 原样保留 |
| 拒识显示 `—`、不显示 `0` | **安全约束** | 原样保留 |
| 人工复核、复核签字、模型版本、权重指纹 | **安全约束** | 原样保留 |
| 「不构成诊断结论」免责条 | **安全约束** | 原样保留 |
| 判读页主 CTA 用墨色 | **场景规范**（Clinical） | 保留；换成钴蓝会与品牌主操作抢语义 |
| 八类概率尺用墨色 + 最高类信号橙 | **场景规范**（Clinical） | 保留；不用分类色 |
| 骨白 + 衬线大标题 + 方角 + 发丝线 | **历史外观** | 允许按 Clinical 新外壳收敛 |
| 顶栏下划线当前态、右侧平铺链接 | **历史外观** | 由共享导航替代 |
| 新闻页四列读数条、橙角标 | **历史外观** | 由 Editorial 版式替代 |
| 个人中心/记录页把元信息放进 KPI 条 | **历史外观** | 改为资料区 + 读数卡（记录页保留合法 KPI 骨架） |
| 首页居中图片 + 衬线大标题 | **历史外观** | 由 Brand 构图替代 |

---

## 4. 可复用资产盘点（不重造）

| 资产 | 位置 | 可复用点 |
|---|---|---|
| 金属虹膜标 + 字标 | `SiteHeader.tsx` → `Wordmark` | 全站唯一字标；两版 SVG 随主题切换 |
| 主导航数据 | `SiteHeader.tsx` → `NAV_LINKS` | 三个真实目的地 |
| 移动抽屉 | `MobileNav.tsx` | 焦点锁、滚动锁、Esc、账号区，原样复用 |
| 账号菜单 | `AccountMenu.tsx` | Base UI Menu、管理员入口、退出 |
| 主题切换 | `theme-provider.tsx` + 按钮 SVG | 原样复用 |
| 品牌玻璃材质 | `brand.css` `.brand-panel--frosted` 等五种 | Editorial / Brand 可直接用；Clinical 取实体面 |
| 品牌页脚 | `brand/BrandFooter.tsx` | 增加 `compact` 变体给新闻门户 |
| 章节头 | `SectionHead.tsx` | 保留；品牌页作用域已把短码换成钴蓝 |
| 记录纸 | `RecordSheet.tsx` | **不动**；任何页面只换外框 |
| 风险/免责 | `RiskTag.tsx` / `DisclaimerBar.tsx` | **不动** |
| 图表 | `admin/charts/*` | 管理端专用，R2.5 不碰 |
| 弹层 | `ui/dialog.tsx`、`ui/menu.tsx` | 统一入口，不手写第二套 |

**结论**：R2.5 不需要新视觉库、新图表库、第二个 GPU 渲染器。新增的是
**一个共享顶栏组件 + 场景变体 + 一页 Editorial 版式 + 品牌层区块样式**。

---

## 5. 逐页方案

> 格式：**现状 → 目标 → 复用组件 → 修改文件 → 风险 → 验收方式**。
> 所有页面都保留真实业务内容与数据口径，不删功能、不虚构指标。

### 5.1 `/` Landing（Brand）

- **现状**：Hero 已是品牌玻璃 + 光带；其后 7 个区块仍是骨白仪器版式。
- **目标**：Hero 之后统一为品牌层构图——更大的留白与网格、玻璃信息卡、
  Manrope 眉线、钴蓝强调；`record` 区用品牌画框**陈列**真实记录纸（纸面不变）；
  `how` 区的八类清单与流程改为「步骤 + 证据」版式；`agent` 区展示真实会话能力，
  不画不存在的多 Agent 节点；结尾 CTA 与页脚保持品牌收尾。
- **复用**：`BrandPanel`、`brand.css` 材质、`SectionHead`、`RecordSheet`、
  `BrandFooter`、`DisclaimerBar`。
- **修改**：`web/src/pages/LandingPage.tsx`、`web/src/styles/brand.css`
  （新增 `.landing-*` 区块规则，不改 `.brand-head` / `.brand-foot` 既有契约）。
- **风险**：`ScrollExpand` 依赖 `[data-site-head]` 与直接子级 sticky；
  区块重排不能改变这个结构。`record` 区不能为了好看降低记录纸可读性。
- **验收**：1440/1920 Light/Dark 整页；390/768 逐区；滚动过程中无横向滚动；
  记录纸仍为白纸；无新 console error；动效离屏即停。
- **落地（R2.5-02，2026-11-13）**：流程区改为「八类实体板 + 步骤卡」，记录纸装入品牌画框，
  Agent 四点改为信息卡，责任边界改深海蓝实体面，收尾 CTA 改胶囊形；证据见
  `docs/assets/iris2/r25/r2-5-02/`。

### 5.2 `/news`、`/news/:id`（Editorial，Brand 之下）

- **现状**：`BrandHeader` + `.is-field` 骨白底 + 仪器台账 + 橙角标样片；
  无封面数据时三列等高卡，短讯被撑成海报；无页脚。
- **目标**：现代医疗科技资讯门户：
  - 根语境 `.is-brand-page`（共享品牌画布），Header 自动取品牌底色；
  - 首条精选做大（标题 + 摘要 + 日期），其余为紧凑编辑式列表/卡片；
  - 无封面时用**排版**而不是空框占位；
  - 检索、分页、加载、空、错误状态用统一控件语言；
  - 详情页正文宽度 68ch、目录 sticky、正文层级清晰、Light/Dark 一致；
  - 列表页用 `BrandFooter compact`，详情页只保留免责与返回。
- **复用**：`BrandHeader`（迁移为共享 Header 的 editorial 变体）、
  `BrandPanel`、`EmptyFrame`、`FaultPanel`、`SectionHead`、`DisclaimerBar`、
  `BrandFooter`、`news.ts` 的真实数据工具。
- **修改**：`web/src/pages/NewsPage.tsx`、`NewsDetailPage.tsx`、
  `web/src/styles/news.css`、`web/src/components/brand/BrandFooter.tsx`（compact）、
  `ChromaGrid` 仅在不破坏其他使用方的前提下调整，否则新闻页不再用它。
- **风险**：本地 13 条全无封面、生产 21 条有 8 条带图——版式必须两种数据都成立；
  搜索/分页是真实接口，不能改成前端假过滤；详情页 HTML 已走 sanitize，不动。
- **验收**：有封面/无封面两种数据；搜索命中/空结果；分页首末页；详情长文/短文；
  390/768/1440/1920 × 双主题；键盘可达；无 console error。
- **落地（R2.5-03，2026-11-13）**：列表改为「最新一条做头版 + 发丝线双栏列表」，
  去掉四列读数条与橙角标；详情正文 68ch、目录 sticky、封面可选；无封面用排版而非空框。
  本地数据全无封面，有封面路径用真实接口响应 + 本地示例图做**布局夹具**验证，
  证据见 `docs/assets/iris2/r25/r2-5-03/`。

### 5.3 `/diagnosis`（Clinical）

- **现状**：旧顶栏 + 步骤条 + 左右两栏；上传槽、读数、错误与结果都在，
  但层次像仪器面板；结果页直接铺记录纸。
- **目标**：现代、精密、专业的影像工作区：
  - 统一 Iris 导航（clinical 变体，实体纸面胶囊 + 信号橙当前态）；
  - 主任务清晰：上传/换图 → 预览与质量提示 → 判读状态 → 记录纸；
  - 进度、错误、拒识、人工复核用统一容器，不改变语义；
  - 图像预览与操作（换图、重置、打印）形成明确操作带；
  - `RecordSheet` 原样嵌入，纸面、风险色、证据链、免责一条不动。
- **复用**：`RecordSheet`、`RiskTag`、`DisclaimerBar`、`FaultNote`、
  `SectionHead`、`ProductHeader` clinical 变体。
- **修改**：`web/src/pages/DiagnosisPage.tsx`、`web/src/styles/app.css`
  （新增 `.workbench-*`，不动 `.slot` 的医学语义）。
- **风险**：判读状态机（empty/ready/running/done/error）、runId 竞态保护、
  未登录暂存影像都不能动；上传槽的分划板是「相机取景」隐喻，保留。
- **验收**：五态截图（空/就绪/进行中/成功/失败）；换图与重置；未登录回跳；
  结果纸 390/768/1440/1920 × 双主题；键盘；无假进度。
- **落地（R2.5-04，2026-11-13）**：页头改为「任务句 + 三步进度」，
  进度条贴右、窄屏落回标题下方且保留步骤名；上传槽成为唯一主任务，
  操作带（开始判读 / 移除）与文件读数归位；读数栏与流程轨共用同一套状态词
  （`STANDBY / READY / READING / DONE / FAIL`），`READING` 只绑定真实的
  在途判读请求（`POST /diagnosis/diagnosis` 同步在途，不是流式接口），
  失败显示 `FAIL`；空槽分划板不再自转（转动只绑定在途判读），待机相位点不再呼吸；
  记录纸与 `RecordSheet` 原样保留，结果页只加一行上下文。概率表新增
  类别名归一（`canonicalClassName`）：算法侧英文标签与后端中文短名统一到
  记录纸规范名，同一类只列一行。证据见 `docs/assets/iris2/r25/r2-5-04/`
  （整改后重拍：夹具对齐真实响应形状、四档宽度 × 空/成功逐档测横向滚动、
  report.json + 键盘走查）。

### 5.4 `/agent`（Intelligence）

- **现状**：旧顶栏 + 三栏铺满；欢迎屏是旧仪器语言；会话栏/消息/资源面板层次弱。
- **目标**：
  - 统一 Iris 导航（intelligence 变体，运行态青/蓝当前态）；
  - 欢迎屏改为简洁的会话入口（真实能力：上传影像、描述症状、了解疾病）；
  - 会话栏：活跃态、置顶、批量、折叠清晰；
  - 消息层次：用户 / 助手 / 推理 / 工具请求 / 工具结果 / 确认，各自可辨；
  - 资源面板与移动端抽屉保持现有交互；
  - 绝不新增后端未提供的节点、依赖或执行状态。
- **复用**：`SessionList`、`MessageList`、`messages/*`、`ResourcePanel`、
  `ChatInput`、`WelcomeScreen`、`AgentScreenDeck`、`ProductHeader` intelligence 变体。
- **修改**：`web/src/pages/AgentPage.tsx`、`web/src/components/agent/*`、
  `web/src/styles/agent.css`。
- **风险**：SSE 事件、会话历史、上传、确认、epoch 竞态与 authed 边界不能动；
  移动端 `agent-viewport` 高度计算不能被顶栏改高破坏（`--nav-h` 同步）。
- **验收**：未登录/登录、空会话/历史会话、流式回复、工具确认、上传；
  390/768/1440/1920 × 双主题；键盘；无 console error。
- **落地（R2.5-05，2026-11-13）**：欢迎屏去掉虚构的神经网络连线图（后端没有多
  Agent 拓扑），改挂全站同一个金属虹膜标 + 三条真实入口；「上传眼底图像」不再发送
  一句空话，而是直接打开输入区的选图对话框。强调色从临床 `--signal` 换成运行态
  钴蓝 / 冰青（发送键、工具标签、LIVE、打字条），医学风险仍只走 `--risk-*`。
  会话栏「选择」收进品牌行，主操作恢复为一枚全宽「新对话」；窄屏（≤900）会话栏
  默认收起、由对话头栏汉堡展开，选会话/新建后自动收回。同时修掉四处布局缺陷：
  窄屏欢迎屏溢出到输入区下方、会话列表被裁且不可滚、Tailwind preflight 抹掉
  markdown 列表标记、textarea 自带焦点框与容器描边打架。
  证据见 `docs/assets/iris2/r25/r2-5-05/`。

### 5.5 `/profile`（Clinical）

- **现状**：旧顶栏 + 超大标题 + 四列读数条 + 头像卡 + 资料表单。
- **目标**：资料区 + 读数卡 + 列表的临床个人域：
  - 统一导航；标题降一档，与资料卡形成清晰层级；
  - KPI 改为「读数卡」，保留真实口径（判读总数、近 10 条高风险、注册时间、角色）；
  - 表单、头像、复诊申请统一控件与焦点；
  - 数据隔离与账号切换行为不变。
- **复用**：`ProductHeader` clinical、`RiskTag`、`DisclaimerBar`、现有表单。
- **修改**：`web/src/pages/ProfilePage.tsx`、`web/src/styles/records.css`（必要时拆出 profile 段）。
- **风险**：账号切换竞态、头像上传、统计「近 10 条」口径注释不能删。
- **验收**：登录/未登录；账号切换；头像上传失败态；双主题四档；
  数据不串号。
- **落地（R2.5-06，2026-11-13）**：四列 KPI 条换成四张读数卡（`DESIGN.md` §1.5
  明确「不套四列 KPI 条」），标签口径原样保留；左列补上真实的「最近判读」列表
  （同页数据取前三条，带置信度与风险标签）与判读台账入口卡，右列仍是资料表单；
  标题从 display 大字降一档为章节级衬线标题。统计口径、账号切换行为、头像上传
  逻辑与数据隔离全部未动。证据见 `docs/assets/iris2/r25/r2-5-06/`。

### 5.6 `/records`（Clinical）

- **现状**：旧顶栏 + 超大标题 + 四列 KPI + 空态/台账 + 展开记录纸。
- **目标**：统一导航；保留「KPI + 台账」合法骨架；收敛标题尺度、行高、分页、
  空态与展开容器；记录纸与人工复核状态原样。
- **复用**：`RecordSheet`、`RiskTag`、`DisclaimerBar`、`ProductHeader` clinical。
- **修改**：`web/src/pages/RecordsPage.tsx`、`web/src/styles/records.css`。
- **风险**：统计口径（总数是全量、其余是本页）、分页、展开与打印不能变。
- **验收**：空/有数据/展开/打印；双主题四档；口径文案仍在。
- **落地（R2.5-06，2026-11-13）**：KPI 读数条 + 台账的骨架保留（这是全站唯一合法的
  「KPI + 台账」临床页），标题降一档；窄屏不再把置信度与风险标签整列藏掉，改为
  挪到行内第二行横排；行内分隔点改为挂在前一项后面，避免换行后出现孤立的「·」；
  翻页控件从借用的 `.news__pager`（路由级样式，记录页根本没加载）换成记录页自己的
  `.records__pager`，含 44px 触控高度与禁用态。记录纸、复核状态、复诊申请、
  统计口径文字与打印样式全部未动。证据见 `docs/assets/iris2/r25/r2-5-06/`。

### 5.7 `/login`、`/register`（Brand 入口）

- **现状**：`AuthShell` 暗房双栏，已有品牌字标与真实表单；无导航是刻意的。
- **目标**：只做**一致性收口**：字标、Manrope、钴蓝主操作、焦点环与按钮令牌；
  不把产品导航塞进认证页。
- **修改**：`web/src/components/AuthShell.tsx`、`LoginPage.tsx`、`RegisterPage.tsx`（必要时）。
- **风险**：`LaserFlow` 是现有 WebGL，不在 R2.5 重做；主题切换、回跳地址不动。
- **验收**：双主题 390/768/1440/1920；键盘；登录/注册真实接口。

### 5.8 `/admin/*`（Management）

- **现状**：独立侧栏，旧 B 档外观。
- **目标**：**R2.5 不动管理端布局与外观**（属 R3）；只保证：
  - 共享 Header/Wordmark 重构不改变 `AdminLayout`；
  - `AdminGate` 错误页的 `SiteFooter` 仍可用；
  - 不把产品胶囊顶栏塞进管理端。
- **验收**：管理端 7 路由冒烟 + 截图；侧栏、表格、弹层无变化。

---

## 6. R2.5 实施计划

### 6.1 设计决策（将写入 `DESIGN.md`）

**One Iris Brand, Multiple Professional Experiences.**

1. **一个共享产品外壳**：公开路由共用同一顶栏组件与导航数据、账号菜单、
   主题切换、移动抽屉、键盘焦点；场景只改变**材质强度、当前态语义与密度**。
2. **Clinical 的医学安全规则 ≠ 保留旧 UI**：纸面、风险语义、复核、证据链不变，
   外壳可以升级。
3. **Brand 页 ≠ 所有区块都用玻璃**：玻璃是信息容器的一种材质，不是背景滤镜；
   大段正文、记录纸、数据清单仍用实体面。
4. **News 是 Brand 之下的 Editorial 变体**：共享品牌画布与导航，版面按资讯门户
   组织，不沿用仪器读数条与橙色角标。
5. **Agent 只升级真实会话工作区**：不虚构多 Agent 节点、任务依赖或执行状态。
6. **Footer 按页面性质选择**：Landing 完整品牌版；News 精简版；详情页只留免责；
   Clinical 工作区/资料页保留 `DisclaimerBar` 不加强制页脚；Agent 不展示页脚。

### 6.2 共享外壳的技术形态

- 新增 `web/src/components/shell/ProductHeader.tsx`：
  - 唯一渲染字标、导航、主题、账号、主 CTA、汉堡；
  - `scene: "brand" | "editorial" | "clinical" | "intelligence"`；
  - 保留 `data-site-head`（`ScrollExpand` 量高）与路由变化重挂；
  - `BrandHeader` / `SiteHeader` 改为薄包装（或直接迁移调用方后删除），
    **不维护第二套逻辑**；
  - 场景差异只通过 `data-scene` + CSS 变量表达：
    - brand / editorial：磨砂胶囊 + 钴蓝实心当前态；
    - clinical：实体纸面胶囊 + 信号橙 2px 当前态 + 墨色主 CTA；
    - intelligence：实体面胶囊 + 冰青/钴蓝当前态 + 运行态弱发光（只用于当前项）。
- 页面根语境决定顶栏底色：`--shell-surface` 由 `.is-brand-page` / `.is-field` 等提供，
  顶栏不再写死 `var(--field)`。
- 页脚：`BrandFooter` 增加 `compact` 变体；News 列表使用；Landing 保持 `full`。
- 断点：390 / 768 / 820 / 900 / 1440 / 1920；≤900 收胶囊，801–900 必须保留汉堡。

### 6.3 分阶段 PR（禁止巨型 PR）

| 阶段 | 分支 | 内容 | 基分支 | 依赖 |
|---|---|---|---|---|
| R2.5-00 | `feat/iris-2-r2-5-00-audit-spec` | 本审计 + `DESIGN.md` Shared Product Shell + 路线图 + `CLAUDE.md` / `web/DESIGN.md` 同步 + before 截图 | #59 分支 | #52 / #55–#59 / #53（已显式合并） |
| R2.5-01 | `feat/iris-2-r2-5-01-shared-shell` | 共享 `ProductHeader` + 场景变体 + 全路由迁移 + 页脚策略 | R2.5-00 | R2.5-00 |
| R2.5-02 | `feat/iris-2-r2-5-02-landing` | 首页 Hero 之后区块 | R2.5-01 | R2.5-01 |
| R2.5-03 | `feat/iris-2-r2-5-03-news` | News / NewsDetail Editorial | R2.5-01 | R2.5-01 |
| R2.5-04 | `feat/iris-2-r2-5-04-diagnosis` | 判读工作区（RecordSheet 不动） | R2.5-01 | R2.5-01 |
| R2.5-05 | `feat/iris-2-r2-5-05-agent` | Agent 会话工作区 | R2.5-01 | R2.5-01 |
| R2.5-06 | `feat/iris-2-r2-5-06-profile-records` | 个人中心 / 记录 | R2.5-01 | R2.5-01 |

> R2.5-02～06 可并行，但都基于 R2.5-01 的共享外壳；合并顺序由评审决定。
> 每个 PR 独立可审查、独立回滚；不合入 `ui`、不部署、不动 `main` / `master`。

### 6.4 每个 PR 的验收门禁

1. `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build` 全绿；
2. 改动前后截图：Light/Dark × 390 / 768 / 1440 / 1920；
3. 真实路由跳转证据：`/ → /diagnosis → /agent → /news → /profile` 连续截图或录屏；
4. 键盘：Tab 顺序、焦点可见、抽屉焦点锁、Esc；
5. 主题：切换不闪、不丢当前路由、控制台无新错误；
6. 会话/判读回归：Agent SSE、判读五态、记录展开；
7. 未解决问题与风险清单写入 PR 正文。

### 6.5 跨路由视觉连续性验收（新增）

从首页依次进入判读、Agent、新闻、个人中心，逐项确认：

| 项 | 通过标准 |
|---|---|
| Logo | 金属虹膜标 + Manrope 字标，尺寸与位置一致 |
| 导航结构 | 同一胶囊、同样三个目的地、同样短码与可访问名称 |
| 当前态 | 有且仅有一个 `aria-current="page"`，语义色按场景切换 |
| 字体 | 导航 Manrope、正文 sans、数字 mono；不混入第二套 |
| 色彩 | 钴蓝=品牌/主操作，信号橙=临床重点，风险色只表示病情 |
| 交互 | 主题切换、账号菜单、移动抽屉行为一致 |
| 移动端 | 820 / 900 两档都有导航入口，无横向滚动 |
| 主体差异 | 判读保留纸面、Agent 保留工作区、新闻保留编辑排版 |

---

## 7. 风险与未决

| 风险 | 影响 | 处置 |
|---|---|---|
| 共享 Header 改变 `ScrollExpand` 量高 | 首页黑画面盖住顶栏的判定失效 | 保留 `data-site-head`；820/900 实测 |
| 临床页换外壳被误解为「降低医学严肃性」 | 评审争议 | `RecordSheet`、风险色、免责、复核一律不动；外壳仅收敛导航与排版 |
| 新闻无封面数据占比高 | 卡片空框显丑 | 版式按「无封面」设计，封面作为增强；两种数据都验收 |
| Agent 后端只有单会话 | 无法做多 Agent 可视化 | 明确不做；只优化真实会话层次 |
| 迁移 `SiteHeader` 调用方遗漏 | 某一页仍显示旧导航 | `grep` 清零 + 路由清单测试；`PlaceholderPage` 一并迁移 |
| 管理端被动继承 | 侧栏/表格改样 | Header 只在公开页挂载；管理端不引用 `ProductHeader` |
| 合并 #53 的 docs 提交 | PR 依赖可见 | 合并提交已注明「#53 进入 ui 后内容一致」；不合入 `ui` 前不重复 cherry-pick |

**未决（需后续阶段确认）**：

- Clinical 变体是否保留 `--nav-h` 64px，还是与品牌顶栏同为 56px 内胆
  （影响 Agent 视口高度计算，R2.5-01 用实测决定）；
- News 详情页是否需要独立页脚（初版只留免责与返回）；
- Landing 的 `record` 区在品牌画框内是否允许轻微缩放/倾斜（初版不做透视，
  避免降低记录纸可读性）。

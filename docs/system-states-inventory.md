# Iris System States Inventory（全局状态盘点）

> 盘点工作树：`D:/Work/code/eye-diagnosis/.worktrees/system-states-react-bits`
> 基线：分支 `fix/system-states-react-bits` @ `63116441`（`feat/r3-phase3-clinical` tip）；
> UI 冻结 tag `iris-ui-v2.1-freeze-20261115` 与已授权的 #88–#90 均在此基线内。
> 盘点日期：2026-11-17。本文件只记录**代码事实**与**整改计划**；「疑点」须运行时验证后才升级为问题。

## 0. 已确认的全局事实

1. 全局状态组件已有一套共同语法，但**视觉语言仍分两代**：
   - `FaultNote` / `FaultToaster`（`web/src/components/fault/`）+ `fault.css` → 仪器读数风格：微型 mono 标签（`9.5–11px`）、发丝线、红/琥珀语义色、小按钮（`2–5px` 内边距，`10.5–11.5px` 字号）。
   - 用户端 R3 页面（Agent / Journal / Diagnosis）→ Blue Optical Glass（钴蓝 `--brand-primary`、青 `--brand-cyan`、极光紫 `--brand-aurora`、Manrope、8–24px 圆角）。
2. UI 冻结范围**不含** Loading / Error / Empty / Recovery 系统状态的这次治理，但本工作树是独立分支，不动冻结页面（首页、管理端六页、知识库、新闻工作台的布局与配色），只治理系统状态组件与其消费点。
3. 许可事实（2026-11-17 已复核，记录于 `docs/design/iris-r3-user-experience-inventory.md` §6 / `web/src/components/brand/THIRD-PARTY-NOTICES.md`）：React Bits 是 **MIT + Commons Clause v1.0**，禁止在公开仓库再分发移植版组件；本仓库既有做法为**独立实现交互、零新增依赖**。本次沿用此口径。

## 1. Inventory 表

| 路由 / 组件 | 当前实现（代码证据） | 问题（已确认 / 疑点） | 整改方案 | 优先级 | 证据 |
|---|---|---|---|---|---|
| App 根 · 启动身份探测 | `SessionProvider` 挂载即 `getLoginUser()`；失败时保留已认出的会话，否则落匿名并给 `probeError`（`web/src/lib/session.tsx:102–129`） | 已确认：`status === "loading"` 期间无全局启动态 UI，页面直接渲染；只有控制台内部状态，没有品牌加载反馈 | 增加不阻塞业务的 `IrisBootStatus`：细窄顶置状态条，只在身份探测超过阈值时出现，成功后淡出；不造假进度、不延长时间 | P2 | `web/src/lib/session.tsx:100–135` |
| App 根 · Suspense fallback | `<Suspense fallback={<PageSkeleton />}>`（`web/src/App.tsx:135`） | 已确认：`PageSkeleton` 是 `min-height:70svh` 的空白 + 11px `LOADING` 文本（`web/src/components/PageSkeleton.tsx:9–14`、`web/src/styles/app.css:659–673`）；整页闪白，丢失 App Shell 与导航，仪器式文案 | 改造成带品牌光学环 + Manrope 文案 + 局部骨架的 Iris 路由加载态；保留既有 `role=status`；reduced-motion 下静态 | P1 | `web/src/App.tsx:135`、`web/src/components/PageSkeleton.tsx`、`web/src/styles/app.css:659` |
| 路由级渲染错误 | `RouteErrorBoundary` 接渲染期错误，复用 `FaultNote variant="panel"`，只给「刷新页面」；`resetKey` 随路由复位（`web/src/components/RouteErrorBoundary.tsx:22–57`） | 已确认：fallback 仍是「ERROR 标签 + 竖线 + 分割线 + 小按钮」的旧仪器面板；文案「已经记下这次错误」在无上报能力时不成立（违反错误恢复要求 §4.4.9） | 独立 `IrisErrorBoundary` 视觉：保留 class 边界的稳定性与 reset 语义，替换为品牌化错误面板（钴蓝图标、清晰的标题/影响说明/双出口）；文案改为事实陈述；提供「重试本页 / 回首页」 | P0 | `web/src/components/RouteErrorBoundary.tsx:34–55`、`web/src/styles/fault.css:276–366` |
| 404 / 未知路由 | `<Route path="*" element={<Navigate to="/" replace />}>`（`web/src/App.tsx:188`） | 已确认：未知地址静默重定向到首页，用户不知道发生了什么；不符合 404 语义 | 增加 `<NotFoundPage>`：品牌化 404，说明「地址不存在」+ 回首页 / 返回上一页；保留鉴权与路由边界 | P1 | `web/src/App.tsx:188` |
| 403 / 权限不足 | `faultFromError` 将 40300 译为「你没有查看这条的权限」（`web/src/lib/faults.ts:148–157`）；`AdminGate` 自绘拒绝页（`web/src/components/admin/AdminGate.tsx:113–131`） | 已确认：文案正确，但 `AdminGate` 与通用故障提示视觉不统一；无需改语义 | 统一 `IrisErrorState` 视觉语言接入 `AdminGate` 的失败分支，不改变其鉴权语义 | P2 | `web/src/lib/faults.ts:148`、`web/src/components/admin/AdminGate.tsx:100–131` |
| 网络错误 / API 失败 | `faultFromError` 集中翻译 5xx / 断网 / 未登录 / 404（`web/src/lib/faults.ts:88–221`） | 已确认：语义分类完善；UI 表现依赖 `FaultNote` 与 `FaultToaster` 的仪器皮肤 | 保留 `Fault` 数据模型与分类，只重做 `FaultNote` block/panel 与 toast 的视觉，让语义层几乎不改 | P1 | `web/src/lib/faults.ts`、`web/src/components/fault/FaultNote.tsx` |
| 瞬时故障浮条 | `FaultToaster`：右上浮条，最多 3 条，critical 9s 且不可划走，其他可下滑关闭（`web/src/components/fault/FaultToaster.tsx:34–46, 76–205`） | 疑点：浮条层级 `z-index:80`、位置 `top: calc(var(--nav-h) + 58px)` 可能与新导航 / Agent 头栏重叠；需运行时验证 | 保留交互与计时逻辑，升级卡片视觉；浏览器验收时检查重叠 | P2 | `web/src/components/fault/FaultToaster.tsx`、`web/src/styles/fault.css:28–174` |
| 页内故障面板（新闻/记录） | `FaultPanel` 组件，8 个调用点（NewsPage / NewsDetailPage / RecordsPage / RecordDetailPage），红细边框 + FAULT 标签 + 仪器分割线（`web/src/components/FaultPanel.tsx:9–49`、`web/src/styles/app.css:1399–1464`） | 已确认：与 `FaultNote panel` 重复实现同一语义，且是典型的「旧仪器式 UI」 | 让 `FaultPanel` 复用新的 `IrisErrorState`（或收口为 `FaultNote panel` 的新视觉），删掉重复的仪器 CSS；不动业务调用处的重试回调 | P0 | `web/src/components/FaultPanel.tsx`、`web/src/pages/{NewsPage,NewsDetailPage,RecordsPage,RecordDetailPage}.tsx` |
| 数据 Skeleton | 各处手写：新闻 `.news-skeleton__card`、记录 `.records__skeleton`、表格 `.admin-dt__skeleton`、详情骨架、Agent Thinking 行 | 已确认：样式与真实内容结构已基本匹配（R3 已做一轮）；缺少统一的状态语义（`aria-hidden` 已用，但 `aria-busy` 只在 admin 表格有） | 统一为 `IrisSkeleton` 的**样式约定**（不强行组件化）：补充 `aria-busy`、分类文档，保留各页已有骨架结构，避免布局跳动 | P2 | `web/src/pages/NewsPage.tsx:144`、`web/src/pages/RecordsPage.tsx:227`、`web/src/components/admin/DataTable.tsx:175–185,282` |
| 空状态 | `EmptyFrame`（记录封面无图占位）/ `AdminEmpty` / `InsightEmpty` / 各页手写空文案 | 已确认：`EmptyFrame` 是图片占位而非页面级空态；页面级空态文案已较具体（R3 已做） | 新增 `IrisEmptyState` 作为**可选**页面级空态统一入口，仅在新状态组件内使用；不批量改写冻结的空态页面 | P2 | `web/src/components/EmptyFrame.tsx:7–25`、`web/src/components/admin/AdminEmpty.tsx` |
| Agent 等待 / 断连 / 失败 | `LatticeLoader`（SVG 点阵 CSS 动画、后台暂停、reduced-motion 静态）；SSE 断线走 `faultFromError` 浮条；消息级 loading 在 `AssistantMessage` | 已确认：`LatticeLoader` 已是目标方向，可作为 iris 加载视觉基准；疑点：断连后已到消息是否保留——需运行时验证 | 复用 `LatticeLoader` 的点阵/光学环作为 IrisLoader 视觉源；**不改 SSE 事件契约、不改 Agent 状态机**；只替换共用状态外观 | P1 | `web/src/components/agent/LatticeLoader.tsx:1–65`、`web/src/lib/agentStream.ts` |
| 图片上传与推理 | `DiagnosisPage` 有真实体积上限与上传失败提示（`faultFromError(intent:'upload')`）；三阶段工作区 | 疑点：上传中的进度是否如实（需查看实现）——本轮只治理状态外观，不引入模拟进度 | 保持真实进度口径；对外观统一使用新的状态组件 | P2 | `web/src/pages/DiagnosisPage.tsx`、`web/src/lib/faults.ts:88–98` |
| 硬编码颜色 / 暗色适配 | `web/src/styles/hardcoded-colors.test.ts` 已有门禁（R3 加入） | 已确认：有自动检查，新增状态样式必须通过它 | 所有新视觉只用既有 `--brand-*` / `--risk-*` / `--surface` / `--fg-*` 令牌；不新增品牌色 | P1 | `web/src/styles/hardcoded-colors.test.ts` |
| 动画时长 / 缓动 | `--motion-fast/base/slow = 140/240/420ms`、`--ease`（`web/src/styles/tokens.css`） | 已确认：`fault.css` 使用 260/180/240ms，未复用统一令牌；新状态样式统一走 `--motion-*` | 用 `var(--fast)` / `var(--base)`；reduced-motion 必须实质减少 | P2 | `web/src/styles/tokens.css`、`web/src/styles/fault.css:38,165,178` |

## 2. 本轮明确不治理（避免扩大影响面）

- 冻结页面本身的布局与配色（首页 / 管理端六页 / 知识库 / 新闻工作台）；
- Agent SSE 事件、工具确认语义、后端协议；
- 各业务页已有的**具体空态文案**（已符合语义要求，只需视觉外壳一致）；
- 已验证的 React Bits 许可结论不重新引入组件源码。

## 3. React Bits 选型结论（摘要；完整 ADR 见实现报告）

| 组件 | 上游依赖 / 许可 | 决定 |
|---|---|---|
| Fade Content | MIT + Commons Clause；TS+Tailwind 变体通过 shadcn 分发 | **不引入**；用既有 `.reveal → .is-in` / CSS `@keyframes` 独立实现渐入 |
| Blur Text | 部分变体依赖 `motion`（framer-motion）；同许可 | **不引入**；品牌文字入场用短 CSS blur/opacity 过渡，reduced-motion 关闭 |
| Shiny Text | CSS 渐变位移；同许可 | **不引入**；加载文案高光用轻量 CSS，不新增依赖 |
| Orb | 部分变体需要 three/OGL/WebGL；同许可 | **仅作参考**，用纯 CSS/SVG 光学环，无 WebGL 依赖 |
| Glass Surface / Aurora / Spotlight Card | 玻璃与光效；同许可 | **不引入**；现有 `--brand-glass-*` 令牌与 Optic Glass 已覆盖 |

理由：公开仓库再分发移植组件触碰 Commons Clause；且现有项目已有 Motion / CSS / 令牌能力，新增依赖与体积不可取。

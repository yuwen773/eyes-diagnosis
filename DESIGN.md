---
name: Iris 2.0 · Adaptive Visual System
description: "眼科 AI 判读产品：一套品牌身份、四种表达强度；用户端 Blue Optical Glass，管理端 Purple Medical SaaS。"
colors:
  # Primary · 用户端品牌
  brand-canvas: "#f2f6fc"
  brand-surface: "#ffffff"
  brand-text: "#16233a"
  brand-muted: "#5b6b82"
  brand-primary: "#2457c9"
  brand-primary-fg: "#ffffff"
  brand-cyan: "#006f82"
  brand-aurora: "#6b56c5"
  brand-spark: "#2e8bdd"
  brand-glass: "rgba(255, 255, 255, 0.68)"
  brand-glass-layered: "rgba(255, 255, 255, 0.7)"
  brand-surface-deep: "#0a1a33"
  brand-deep-text: "#eaf2ff"
  brand-deep-muted: "#9fb3cf"
  # Secondary · 管理端
  admin-canvas: "#f4f1fa"
  admin-surface: "#ffffff"
  admin-surface-deep: "#ece7f6"
  admin-sidebar: "#f8f5fd"
  admin-text: "#211b33"
  admin-text-muted: "#5d5670"
  admin-text-faint: "#69617e"
  admin-primary: "#6d28d9"
  admin-primary-strong: "#5b21b6"
  admin-on-primary: "#ffffff"
  admin-accent: "#7c3aed"
  # Tertiary · 当前态 / 医学严重度 / 分类数据
  paper-signal: "#d9541f"
  signal-text: "#bd4515"
  risk-normal: "#2f7d55"
  risk-attention: "#96690f"
  risk-critical: "#a83226"
  danger: "#b4374a"
  viz-series-1: "#356f95"
  viz-series-2: "#3f7d72"
  viz-series-3: "#6a7f3f"
  viz-series-4: "#7a5f8a"
  viz-series-5: "#96694a"
  viz-series-6: "#6f767b"
  # Neutral · 页面 / 纸面 / 墨色
  field: "#f3f4f1"
  surface: "#ffffff"
  surface-2: "#e9ebe6"
  surface-3: "#dfe2dc"
  paper-surface: "#ffffff"
  paper-ink: "#14171a"
  paper-ink-2: "#5c6367"
  paper-ink-3: "#676e72"
  paper-line: "rgba(20, 23, 26, 0.13)"
  paper-line-strong: "rgba(20, 23, 26, 0.34)"
  dark: "#161a18"
  on-dark: "#f4f5f1"
  night-bg: "#0b0d0c"
  # 暗主题覆盖（html.dark 重定义同名令牌；下列键名仅作文档索引，不是新的 CSS 变量）
  field-dark: "#0b0d0c"
  surface-dark: "#1d2220"
  brand-canvas-dark: "#0b1425"
  brand-surface-dark: "#17263d"
  brand-text-dark: "#eff6ff"
  brand-primary-dark: "#85b5ff"
  brand-primary-fg-dark: "#0b1425"
  admin-canvas-dark: "#12101c"
  admin-primary-dark: "#b39dfb"
  admin-on-primary-dark: "#171322"
  signal-dark: "#ef7a45"
  risk-normal-dark: "#58b183"
  risk-attention-dark: "#cf9a37"
  risk-critical-dark: "#d96153"
typography:
  display:
    fontFamily: "Noto Serif SC, Source Han Serif SC, Songti SC, STSong, SimSun, Georgia, serif"
    fontSize: "clamp(40px, 6.2vw, 88px)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Noto Serif SC, Source Han Serif SC, Songti SC, STSong, SimSun, Georgia, serif"
    fontSize: "clamp(28px, 3.2vw, 46px)"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Noto Serif SC, Source Han Serif SC, Songti SC, STSong, SimSun, Georgia, serif"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  label:
    fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0em"
  mono:
    fontFamily: "IBM Plex Mono, JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.1em"
    fontFeature: "tabular-nums"
  readout:
    fontFamily: "IBM Plex Mono, JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
    fontFeature: "tabular-nums"
  brand-ui:
    fontFamily: "Manrope Variable, Manrope, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  button:
    fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, Segoe UI, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  none: "0"
  hair: "3px"
  sm: "4px"
  chip-xs: "5px"
  chip-sm: "7px"
  md: "8px"
  chip: "9px"
  admin-control: "10px"
  field: "11px"
  lg: "12px"
  admin-card: "18px"
  admin-card-lg: "20px"
  panel-sm: "18px"
  panel: "22px"
  xl: "24px"
  "2xl": "38px"
  pill: "999px"
  circle: "50%"
spacing:
  "2xs": "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  section: "clamp(68px, 9vh, 108px)"
components:
  button-primary:
    backgroundColor: "{colors.paper-ink}"
    textColor: "{colors.field}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0 26px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, {colors.paper-ink} 85%, {colors.surface})"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.paper-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0 26px"
    height: "52px"
  button-brand-primary:
    backgroundColor: "{colors.brand-primary}"
    textColor: "{colors.brand-primary-fg}"
    typography: "{typography.brand-ui}"
    rounded: "{rounded.pill}"
    padding: "13px 22px"
  button-admin-primary:
    backgroundColor: "{colors.admin-primary}"
    textColor: "{colors.admin-on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  brand-panel:
    backgroundColor: "{colors.brand-glass-layered}"
    textColor: "{colors.brand-text}"
    rounded: "{rounded.xl}"
    padding: "24px"
  stat-tile:
    backgroundColor: "{colors.admin-surface}"
    textColor: "{colors.admin-text}"
    rounded: "{rounded.admin-card}"
    padding: "20px 22px"
  input-field:
    backgroundColor: "transparent"
    textColor: "{colors.paper-ink}"
    typography: "{typography.readout}"
    rounded: "{rounded.none}"
    padding: "0 13px"
    height: "46px"
  risk-tag:
    textColor: "{colors.risk-critical}"
    typography: "{typography.mono}"
  nav-pill:
    backgroundColor: "{colors.brand-glass}"
    textColor: "{colors.brand-text}"
    typography: "{typography.brand-ui}"
    rounded: "{rounded.pill}"
    padding: "5px"
    height: "64px"
---

# Design System: Iris 2.0 · Adaptive Visual System

## Overview

**Creative North Star: "Light over Measurement · 光包住的测量"**

Iris 的外壳是光：钴蓝、银蓝与冰青的光学玻璃，让公开层看起来像一支能把复杂视觉信息讲清楚的团队。内核是测量：白纸、墨字、发丝线、等宽读数与印章，让临床层读起来像一份可以被复核的报告。仪器不是全站的皮肤，而是被光包住的那一层。

产品按使用场景分配表达强度：Brand 高、Management 中、Intelligence 中高、Clinical 低。强度指的是材质、圆角与动效预算，不是信息量，更不是品牌身份。首页、判读、Agent、新闻、记录与个人中心共享同一个产品外壳与同一套导航语言；管理端走独立的紫色医疗 SaaS 令牌；判读记录在任何场景下都是同一张白纸。

温度靠文案与留白表达，不靠暖色；彩色只做语义。医学措辞、风险标签、人工复核、证据链、数据隔离与可访问性不因场景放松。**Iris 2.1 UI 已于 2026-11-15 冻结**：一般视觉优化登记 Issue，阻断性故障与安全修复例外，详见根 `CLAUDE.md`。

**Key Characteristics:**
- 两条视觉产品线：用户端 Blue Optical Glass（钴蓝 + 银蓝光学玻璃），管理端 Purple Medical SaaS（管理紫）。
- 四种场景共享令牌与语义，不共享骨架；KPI + 台账只属于台账型页面。
- 三套语义色互不顶替：`--signal` 当前态、`--brand-*` 品牌身份、`--risk-*` 医学严重度。
- 纸面原语 `--paper-*` 永不随主题翻转；判读记录永远是一张白纸。
- 发丝线优先，阴影只做浮层；玻璃的厚度来自内侧高光，不来自更厚的模糊。
- 数字是读数：等宽 + `tabular-nums`；严重度永远带文字标签。

## Colors

色板按语义域组织，不按色相组织。用户端、管理端、临床语义与分类数据各持一套令牌，彼此不得借值。

### Primary

- **Cobalt Blue**（`--brand-primary`）：用户端品牌主色。首页主 CTA、导航当前态、链接强调与光学材质的核心色；暗主题下 `html.dark` 把同一令牌翻为 `#85b5ff`，压字改用深底。
- **Silver-Blue Canvas**（`--brand-canvas`）：品牌画布。落地页、新闻、判读、记录与 Agent 页共用同一块舞台底色，消除半页品牌、半页骨白的断层。
- **Optical Cyan**（`--brand-cyan`）：只做光学材质里的冷调高光与折射，不承载文字语义。
- **Aurora Violet**（`--brand-aurora`）：极光紫，只做局部点缀与智能体类别标识，面积不超过一个色块。
- **Glass Whites**（`--brand-glass`、`--brand-glass-layered`）：半透明面板的底色；透明度与描边成对出现，不能只取其一。

### Secondary

- **Management Violet**（`--admin-primary`）：管理端主操作、当前导航、精选卡与图表强调。暗主题下 `html.dark` 把同一令牌翻为 `#b39dfb`，压字用深紫墨而非白色。
- **Violet Canvas / Sidebar**（`--admin-canvas`、`--admin-sidebar`、`--admin-surface-deep`）：管理端的三层紫白表面，负责画布、侧栏与嵌入容器的明度分层。
- **Violet Ink**（`--admin-text`、`--admin-text-muted`、`--admin-text-faint`）：管理端三级文字；淡紫发丝线取管理紫的低透明度，不取中性灰。

### Tertiary

- **Signal Orange**（`--paper-signal` / `--signal-text`）：当前态、重点标记与模型标记。承载文字时用压深一档的 `--signal-text` 保证对比度。
- **Medical Risk**（`--risk-normal`、`--risk-attention`、`--risk-critical`）：只表示病情严重度；暗主题下 `html.dark` 把 `--risk-*` 翻为对应的提亮值。
- **Destructive Rose**（`--danger`）：只用于删除会话、删除记录这类不可逆的数据动作，与医学风险分属两条色相。
- **Data Series**（`--viz-series-1` … `--viz-series-6`）：只用于数据图表的分类系列，不占用信号橙、风险色与管理紫。

### Neutral

- **Cool Bone**（`--field`）：页面底。冷调骨白，暗主题翻为 `--night-bg`。
- **Paper White**（`--surface`、`--paper-surface`）：卡片与判读纸面；纸面原语不参与主题翻转。
- **Ink**（`--paper-ink`、`--paper-ink-2`、`--paper-ink-3`）：正文、次级与三级文字。发丝线取墨色的低透明度（`--paper-line`、`--paper-line-strong`）。
- **Reverse Band**（`--dark`、`--on-dark`、`--night-bg`）：局部反相带与整页暗房；它们与根主题正交，可以出现在浅色页面内部。

### Named Rules

**The Three Sets Rule.** `--signal`、`--brand-*`、`--risk-*` 是三条独立的语义轴，任何一条都不得顶替另一条。管理紫 `--admin-*` 是第四条轴，只表示管理品牌与操作。改品牌色不动风险色，改风险色不动品牌色。

**The Paper Rule.** `--paper-*` 永不随主题翻转。判读记录在任何主题、任何外壳里都是同一张白纸；暗主题只翻页面底，不翻纸。

**The Rarity Rule.** 信号橙只做标记与当前态，面积克制，永远不是主 CTA。它的稀缺性就是它的语义。

## Typography

**Display Font:** Noto Serif SC（含 Source Han Serif SC、Songti SC、Georgia 回退）
**Body Font:** Noto Sans SC（含 PingFang SC、Microsoft YaHei、system-ui 回退）
**Label/Mono Font:** IBM Plex Mono（含 JetBrains Mono、Cascadia Mono、Consolas 回退）
**Brand Font:** Manrope Variable（拉丁字形；汉字按字形回退 Noto Sans SC）

**Character:** 衬线负责结论与标题，像判读报告；无衬线负责界面与正文，像一台安静的仪器；等宽负责所有读数，让数字不撒谎。品牌层另用 Manrope，字重更紧、字距更收，是同一身份的公开表达。

### Hierarchy

- **Display**（400，`clamp(40px, 6.2vw, 88px)`，1.08）：首页与品牌页的主标题，一屏只出现一次。
- **Headline**（400，`clamp(28px, 3.2vw, 46px)`，1.2）：章节标题与判读结论；`RecordSheet` 的结论用同一档。
- **Title**（500，19px，1.35）：卡片、面板与小节标题；管理端页头另用 Manrope 600，台账页 24–30px、门面页 30–36px。
- **Body**（400，15px，1.6）：正文与界面文字；长文控制在 65–75ch 以内。
- **Label**（500，13px）：字段标签、章节说明与按钮文字；不再缩小成微型大写眉线。
- **Readout**（500，11–13px，字距 0.1em，`tabular-nums`）：置信度、概率、计数、时间戳、哈希、状态短码。

### Named Rules

**The Readout Rule.** 所有数字、时间戳、哈希、置信度、概率与计数一律 `--font-mono` + `font-variant-numeric: tabular-nums`。置信度一律百分比 + 一位小数，缺省显示 `—` 而不是 `0`。数字是读数，不是装饰。

**The Serif-400 Rule.** 衬线标题只用 400，不合成加粗，不用斜体。需要更强层级时放大字号或换场景，不换字重。

**The No-Micro-Label Rule.** 标签停在 11–13px 的正文或等宽档，不缩成 10px 大写眉线。章节信息并入标题行（`.sec-head__line`），不压在标题上方另起一行。

## Layout

版心是阅读宽度，不是屏幕宽度：`--maxw` 为 1240px，`--gutter` 为 40px；≥2200px 时放宽到 1760px / 56px，≤600px 时收到 24px。公开路由的顶栏高度是 `--nav-h: 80px`（上下各 8px 呼吸 + 64px 内容），管理端侧栏 252px、顶栏 64px、内容版心最大 1920px。

区块节奏靠 `clamp(68px, 9vh, 108px)` 的纵向留白与发丝线建立，不靠卡片堆叠。管理端工作区用「侧栏 + 顶栏 + 内容」三层，公开路由用「顶栏 + 版心 + 页脚」三层；认证页没有产品导航，只有双栏入口。

**路由归属（对照 `web/src/App.tsx`）**

| 路由 | 页面 | 场景 | 外壳 / 语境 |
|---|---|---|---|
| `/` | LandingPage | Brand | `.is-field` / `.is-night` + `.is-brand-page`；首屏 `.iris2` |
| `/login`、`/register` | LoginPage / RegisterPage | Brand | `AuthShell` 双栏（`.auth-auth`），无导航 |
| `/news`、`/news/:id` | NewsPage / NewsDetailPage | Brand（Editorial） | `.is-field .is-brand-page` |
| `/diagnosis` | DiagnosisPage | Clinical | `.is-field .is-brand-page` + `.is-sheet` |
| `/records`、`/records/:id` | RecordsPage / RecordDetailPage | Clinical | `.is-field .is-brand-page` |
| `/profile` | ProfilePage | Clinical | `.is-field .is-brand-page` |
| `/agent` | AgentPage | Intelligence | `.is-field .is-brand-page` 工作区 |
| `/agent/collaboration` | CollaborationPage | Intelligence | `.is-field .is-brand-page`；构建期开关控制入口 |
| `/doctor-reviews` | DoctorReviewsPage | Intelligence | `.is-field .is-brand-page`；医生复核工作区 |
| `/admin/*` | 七页管理端 | Management | `.is-admin` + 独立侧栏 |
| `*` | NotFoundPage | — | 站内 404，不重定向 |

**断点（2026-11-21 实现快照）**：900px 是主断点（24 处），640px（13 处）与 768px（7 处）次之；2200px 只用于超宽版心。历史遗留的 480 / 520 / 560 / 600 / 760 / 780 / 860 / 980 / 1024 / 1080 / 1100 / 1280 / 1600 仍散落在各页，新增样式优先落在 390 / 768 / 900 三档。

### Named Rules

**The Reading Width Rule.** 版心是阅读宽度：1240px 在 1920 屏上留白是呼吸，不是空洞；只有 ≥2200px 才放宽到 1760px，不为填满屏幕而拉长行长。

**The Scene Owns the Skeleton Rule.** 场景决定骨架，不决定是否高级。KPI 条 + 台账只属于台账型页面；概览页以 KPI 与图表为主，编辑页以表单为主，认证页是双栏，Agent 是工作区。

## Elevation & Depth

这套系统是**发丝线优先**的：默认用 1px 的墨色或品牌发丝线分层，阴影只在真正离开页面的层（浮层、下拉、模态、抽屉）与管理端卡片上出现。临床纸面完全不用阴影，靠边框与内部分隔线立起来。

### Shadow Vocabulary

- **Overlay**（`0 10px 26px rgba(20, 23, 26, 0.09)`）：下拉、tooltip、轻浮层。
- **Modal**（`0 22px 46px -32px rgba(20, 23, 26, 0.55)`）：模态与抽屉。
- **Brand Glass**（`0 20px 54px rgba(51, 84, 143, 0.09)`）：品牌玻璃面板的蓝墨投影，只配玻璃材质。
- **Admin Card**（`0 1px 2px rgba(61, 44, 105, 0.04), 0 14px 32px -22px rgba(61, 44, 105, 0.38)`）：管理端卡片与台账容器。
- **Admin Overlay**（`0 14px 34px rgba(61, 44, 105, 0.16)`）：管理端模态与抽屉。

**焦点**：全站 `:focus-visible { outline: 1px solid currentColor; outline-offset: 3px; }`；管理端换成 2px 管理紫。禁止在组件里写 `outline: none` 压掉焦点环。

**滚动条**：全站一套透明轨道 + 胶囊滑块，滑块浓度从当前上下文的 `--fg` 派生（静置 30%，hover 52%）；浅色、深色、暗房与管理端自动换色，不另立轨道。

### Named Rules

**The Hairline First Rule.** 默认分层用发丝线，不用阴影。只有浮层、模态与管理卡才允许投影；临床纸面永远不加阴影。

**The Glass Thickness Rule.** 玻璃的厚度来自内侧高光与边缘描边，不来自更厚的 `blur()`。做不到「能透出背景层次、边界清楚」，就不要叫它玻璃。

## Shapes

形状由场景拥有，不由组件一刀切。Clinical 是方的：`--radius-none`，纸面、按钮、输入、弹层全部直角。Management 用作用域圆角：按钮 8px、输入/段控 10px、卡片 18px、重点卡 20px，不改全局 `--radius-lg`。Intelligence 用 12px 的工作台面板。Brand 用 24px 的信息卡与 38px 的首屏外壳，导航胶囊取 `--radius-pill`。

圆角梯本身是开放的：`none / hair / sm / chip-xs / chip-sm / md / chip / field / lg / panel-sm / panel / xl / 2xl / pill / circle`，加上管理端三项作用域值。边框统一 1px；只有品牌玻璃用内侧高光补厚度，其余表面靠明度差与发丝线。

### Named Rules

**The Scene Owns the Corner Rule.** 圆角由场景决定：Clinical 0、Management 8–20px、Intelligence 12px、Brand 24–38px。同一个按钮在四个场景取四个变体，不追求全站同一种圆角。

## Components

### Buttons

按钮有三套真实形态，按产品线与场景分开，不互相冒充。

- **Shape:** Clinical 直角（0），高 52px；Management 8px 圆角，高 40px；Brand 药丸（999px），首屏内边距 13×22px、顶栏 0 18px。
- **Primary（Clinical）:** 分两层看。组件基类 `.btn` 是墨色实底 + 上下文底色（`--bg`）文字，消费 `--fg` / `--bg`；Clinical 路由自 U3 起统一带 `.is-brand-page`，产品外壳内的 `.btn` 因此渲染为钴蓝实底 + `--brand-primary-fg` 文字（`.dx .btn--ghost` 在判读页恢复透明描边，保住主次层级）。几何（直角、52px）、hover 的 `color-mix` 压深与 active 下移 1px 不因换色改变；品牌色只进操作层，风险仍只由 `--risk-*` 承担。
- **Primary（Brand）:** 钴蓝实底、白字。首屏 CTA 用 Manrope 600 14.5px + `0 14px 28px` 钴蓝投影；顶栏 CTA 用 Manrope 700 13.5px + `0 10px 22px` 投影；品牌页收尾的 `.btn` 继承 Clinical 的 52px 直角几何，只换钴蓝底。
- **Primary（Management）:** 管理紫实底、白字，`--font-sans` 13px/500，高 40px、8px 圆角；hover 用 `--admin-primary-strong`。
- **Ghost:** 透明底 + `--line-strong` / `--admin-line-strong` 描边；hover 提亮描边，不填色。
- **Danger:** 只出现在管理端，用 `--risk-critical` 文字与描边，不用管理紫。
- **Focus:** 1px `currentColor` 外环（管理端 2px `--admin-accent`），offset 3px / 2px。

### Cards / Containers

- **Brand panel:** `.brand-panel` 是唯一玻璃入口，默认 Layered Glass；另有 Frosted（导航）、Soft（入口卡）、Solid（页脚/长文）。前三种是底色 + 描边 + 内侧高光 + 模糊四件套；Solid 用实底、不模糊、无内侧高光。统一 24px 圆角与 `--brand-shadow`。
- **Clinical sheet:** 白纸 + 1px 强发丝线 + 0 圆角，内部用 `sheet__section` 的发丝线分区；不套卡片、不加阴影。
- **Management tile / table:** 白卡 + `--admin-line-soft` 描边 + `--admin-shadow-card`，18px 圆角；精选卡左侧 3px 管理紫竖线 + 淡紫衬底，纯结构，不表状态。
- **Internal padding:** 品牌面板 24px，管理卡 20×22px，临床纸面 `clamp(24px, 3.2vw, 46px)`。

### Inputs / Fields

- **Style:** 透明底、1px `--line-strong` 描边、直角、高 46px，等宽 13px 字；标签是 11px 等宽大写，字段下方留 7px 间距。
- **Focus:** 描边转 `--ink`，底色转 `--field`；不使用外发光。
- **Error:** `aria-invalid="true"` 时描边转 `--risk-critical`，旁边必须有一行文字说明。
- **Placeholder:** `--ink-3`，字距略放，不用斜体。

### Navigation

- **Product header:** 公开路由唯一顶栏，sticky，高 80px，品牌画布底；中央是 Frosted Glass 胶囊（`--brand-glass` + 18px blur），当前项为钴蓝实心胶囊，右侧是主题切换、账号菜单与主 CTA。`scene` 只标记语境，不改构图。
- **Mobile:** ≤900px 收为菜单按钮 + 抽屉；焦点进入、Escape 关闭、关闭后焦点返回、滚动锁；触控目标 ≥44×44。
- **Admin sidebar:** 252px 常驻侧栏，当前项为浮起白卡 + 管理紫图标砖；暗主题改为淡紫衬底 + 亮紫图标砖。账户身份只在顶栏出现一次。

### Signature: RecordSheet

判读记录是整站唯一的报告呈现。结构固定：页头（编号 / 模型 / 时间）→ 结论 → 读数（置信度 / 严重度 / 人工复核）→ 置信环 → 八类概率尺 → 建议 → 复核提示 → 印章排 → 免责。纸面皮肤永远带 `.is-sheet`，暗房展示才用 `.sheet--night`。拒识是完整结果，不是错误状态；`aiRejected` 与 `requiresReview` 分开陈述。

### Signature: RiskTag / ConfidenceDial / ClassScale

- **RiskTag:** 11px 等宽大写 + 5×5 实心方点，颜色取 `--risk-*`；**永远带文字**，永远不整块填色。
- **ConfidenceDial:** 24 个刻度 + 一段弧，读数用等宽百分比（一位小数），环色取当前 `--fg`；不可只靠颜色表达置信高低。
- **ClassScale:** 带刻度的横尺，不是圆角进度条；普通行用墨色，只有最高类用信号橙，八类概率尺带类别名与数值。

### Data Table

管理端台账用语义化表格（`DataTable` → `<table>`）：mono 10.5px 大写表头（**已知低于 11px 下限，待统一**）、13px 正文、行间 1px 发丝线、hover 轻抬不加阴影；容器 18px 圆角 + 管理卡阴影；排序只在后端支持时出现并带 `aria-sort`；分页强制标注「本页 / 全量」。窄屏横向滚动并保留保底列宽，不把中文列压成一字一行。

### Overlays

弹层统一 Base UI：Portal + 焦点陷阱 + `inert` + 滚动锁 + 嵌套 Esc 栈。管理端模态 12px 圆角、`--admin-surface` 底、`--admin-shadow-overlay`；临床弹层直角；品牌弹层可用玻璃，但必须保留清楚的边界与可读文字。不手写第二套弹层。

### States

**错误 > 空 > 加载**。路由级加载用 `PageSkeleton`（无 shimmer、无脉冲、`aria-live`）；区块错误用 `FaultNote`，保留已有数据；整页错误用 `FaultPanel`；瞬时提示用 `FaultToaster`（critical 不可划走）；空状态用 `EmptyFrame`（一句说明 + 一个 CTA，不用插画）。缺省读数显示 `—`，不是 `0`。

### Named Rules

**The One Header Rule.** 公开路由只有一个顶栏实现。`scene` 只允许调语境与密度，不允许换回纸面胶囊、橙色底线或另一套 Logo 字标。

**The No-Invented-State Rule.** 状态动效必须绑定真实请求或真实运行事件；没有事件就不许动。氛围动效只属于 Brand，且不得暗示未发生的业务行为。

## Do's and Don'ts

### Do:

- **Do** 先判断场景（Brand / Management / Intelligence / Clinical），再选圆角、主色与动效预算。
- **Do** 让严重度同时有文字标签与颜色；`RiskTag` 永远带字。
- **Do** 用 `--font-mono` + `tabular-nums` 排所有数字与读数。
- **Do** 把判读记录放进纸面原语（`.is-sheet`），并保证暗主题下仍是白纸。
- **Do** 用 `--signal` 标记当前态与重点，用 `--admin-primary` 做管理端主操作。
- **Do** 默认用发丝线分层；只有浮层、模态与管理卡才上阴影。
- **Do** 复用同一个 `ProductHeader` 与 Base UI 弹层。
- **Do** 让状态动效绑定真实 SSE / 请求事件，并在 `prefers-reduced-motion` 下当场停。
- **Do** 双主题都验收；纸面原语是唯一例外。
- **Do** 空 / 错 / 加载按「错误 > 空 > 加载」的优先级处理。
- **Do** 所有 AI 输出配「不构成诊断结论，不能替代执业医师」免责；界面用「判读」而不是「诊断」，只有「诊断 Agent」保留为产品名。
- **Do** 保留人工复核状态、复核人、复核结论与意见，以及证据链（模型版本、权重指纹、影像来源、工具来源），不降级为脚注。
- **Do** 按账号 scope 隔离数据；换账号不得看到旧账号的任何读数。
- **Do** 让每个数字都能追到后端端点与口径；全量 / 窗口 / 分页写在标签上。

### Don't:

- **Don't** 用品牌钴蓝或管理紫表示医学严重度。
- **Don't** 把信号橙当主 CTA，或大面积铺橙。
- **Don't** 在暗主题下把判读记录翻成深底白字。
- **Don't** 给 Clinical 页面加圆角卡片、玻璃面板或阴影。
- **Don't** 给每个管理页都套 KPI + 台账；概览页与编辑页各有骨架。
- **Don't** 新增第二个顶栏、第二套弹层或第二个 GPU 背景循环。
- **Don't** 在组件里写死十六进制色值；颜色必须来自令牌。
- **Don't** 画假进度、虚构运行态或虚构业务数字。
- **Don't** 用纯黑页面底或纯黑投影。
- **Don't** 用 10px 大写眉线堆章节标签；标签停在 11–13px。
- **Don't** 省略免责、人工复核或证据链；也不要承诺诊断结论。

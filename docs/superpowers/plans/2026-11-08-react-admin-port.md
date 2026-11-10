# React 版管理后台移植实施计划

> **历史快照（2026-11-10 更新）**：本计划写于后端还没有资讯生命周期建模之时，
> 其中「新建新闻」相关的两处描述已被后端提交 `4a3f0ac` 推翻：`/news/edit` 在
> `id` 为空时创建并返回新 id，下拉新增 `status=3 待审核`，并接受 `note`
> （审核意见 / 下架原因）。具体做法见本计划 Task 2 / Task 9 的实现与
> `web/src/pages/admin/AdminNewsEditPage.tsx`。其余步骤仍有效。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Vue 版管理员前端（6 页 + 新闻编辑页）全量移植到 `web/` React 前端——独立仪表梁布局、AdminGate 三分支守卫、手写 SVG 图表、按真实 VO 字段修正的三处 Vue 版缺陷。

**Architecture:** 先落逻辑层（`lib/adminApi.ts` 管理域 API + `lib/adminDomain.ts` 纯函数），再落外壳（AdminLayout/AdminGate/路由），然后是原语（DataTable/Toolbar/StatTile/Modal/Drawer + 4 个图表组件），最后垂直灌入 7 个页面。UI 全部手写 CSS 消费上下文令牌，不引任何 UI 库/图表库。

**Tech Stack:** React 19 + TS + react-router-dom 7 + vitest（已有）+ 手写 CSS。**零新增依赖。**

**Spec:** `docs/superpowers/specs/2026-11-08-react-admin-port-design.md`（本计划逐节实现该 spec；冲突时以 spec 为准）

## Global Constraints

- 所有路径相对仓库根；React 应用在 `web/`，命令一律在 `web/` 下运行。
- 测试：`npx vitest run <file>`；类型检查：`npm run typecheck`。每个任务两关都过才 commit。
- 提交信息中文约定式 + 尾行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- API 信封 `{code:0, data, msg}`，统一抛 `ApiError`（`web/src/lib/api.ts`）；40100=未登录（自动广播 AUTH_EXPIRED_EVENT 跳登录，勿在 admin 层重复实现）；40101=无权限。
- **列表一律走非缓存端点**（`/user/list/page/vo`、`/news/list/page/vo`、`/diagnosis/list/page/vo`，不带 `/cache`）。
- **雪花 id 一律 `string`**（AdminUser.id、AdminNews.id、AdminDiagnosis.id）；KnowledgeDoc.id 是普通自增 `number`（后端实体非雪花）。
- 样式只写手写 CSS，新样式进 `web/src/styles/admin.css`（在 `web/src/index.css` `@import`）；组件只消费上下文令牌 `--bg/--fg/--fg-2/--fg-3/--hr/--hr-strong/--signal/--risk-*` 与图表令牌 `--viz-accent/--viz-mute`。双主题（`html.dark`）自动成立，禁止写死色值。
- 图表令牌追加进 `tokens.css`：浅色 `--viz-accent:#d9541f / --viz-mute:#8b9195`，暗色（html.dark 块内）`--viz-accent:#d9591f / --viz-mute:#767d79`（spec §4.2，校验器已实跑通过，勿改值）。
- **橙色不标状态**：状态一律 risk 三色 + 文字标签；橙色只做当前导航项/主按钮/图表主系列。
- AI 装饰零容忍；mock 页右上角常驻「示例数据 · SAMPLE」mono 小标。
- 新闻新建模式（`:id=new`）下封面上传按钮禁用并注明「保存后可上传封面」（后端 uploadCover 需已存在 id）；保存成功后 `navigate` 到 `/admin/news/{id}/edit`。
- dev 环境 Vite 代理 `/api → http://localhost:8081`（`web/vite.config.ts` 已配）。

## Review Focus

spec 隐含但任务测试未覆盖、人工验收优先盯的输入/故障模式：

1. **匿名/他人会话撞 admin API**（直接输 URL 进 /admin、会话过期后点分页）：期望 40100 跳登录页带 `?redirect=` 回跳，40101 显示无权限页而非白屏。→ Task 3 的 AdminGate 人工验收步骤钉住（AdminGate 自身读 session，不发探测请求）。
2. **知识库轮询泄漏**（离开页面时 `status===0` 仍在轮询、或全部完成后不停）：期望卸载时清定时器、无 processing 文件时不启动。→ Task 10 人工验收步骤钉住。
3. **雪花 id 精度**（诊断/新闻 id 超出 JS 安全整数）：期望列表渲染、删除、复核全程 string，无 `Number(id)`。→ Task 8/9 人工验收步骤钉住（grep 检查无 Number(id) 转换）。
4. **暗房主题下图表可读性**（`--viz-accent/--viz-mute` 暗色档、发丝网格在暗底下不可见）：期望两个主题下网格、标签、标记全部可读。→ Task 5 与 Task 12 人工验收钉住。
5. **新建新闻正文恰好 29/30 字的边界**：29 字拦、30 字放（后端 `content.substring(0,30)` 对 <30 抛异常）。→ Task 2 测试 `newsContentValid` 边界钉住。

---

## File Structure

```
web/src/
├── lib/
│   ├── adminApi.ts          # [新建] 管理域 API：用户/新闻/诊断/知识库 端点与类型
│   └── adminDomain.ts       # [新建] 纯函数：复核状态映射/删除守卫/摘要校验/分布排序
├── components/admin/
│   ├── AdminLayout.tsx      # [新建] 仪表梁 + 侧栏 + <Outlet/>
│   ├── AdminGate.tsx        # [新建] 路由守卫三分支
│   ├── DataTable.tsx        # [新建] 语义化表格（分页/三态）
│   ├── Toolbar.tsx          # [新建] 一行工具条（搜索/筛选/操作）
│   ├── StatTile.tsx         # [新建] KPI 读数块
│   ├── Modal.tsx            # [新建] 手写弹层
│   ├── Drawer.tsx           # [新建] 右侧抽屉
│   └── charts/
│       ├── TrendChart.tsx   # [新建] SVG 折线（十字准线 tooltip + 端点直标）
│       ├── MiniTrend.tsx    # [新建] 迷你折线（小倍数单元格）
│       ├── MiniBars.tsx     # [新建] 迷你柱图（小倍数单元格）
│       └── RankedBars.tsx   # [新建] 排序横条
├── pages/admin/
│   ├── AdminDashboardPage.tsx    # [新建] mock
│   ├── AdminUsersPage.tsx        # [新建]
│   ├── AdminNewsPage.tsx         # [新建]
│   ├── AdminDiagnosisPage.tsx    # [新建]
│   ├── AdminKnowledgePage.tsx    # [新建]
│   ├── AdminDataAnalysisPage.tsx # [新建] mock
│   └── AdminNewsEditPage.tsx     # [新建]
├── styles/admin.css        # [新建] admin 区域样式
├── styles/tokens.css       # [修改] 追加 --viz-accent/--viz-mute（浅+暗）
├── index.css               # [修改] @import admin.css
├── App.tsx                 # [修改] /admin 路由树
└── components/AccountMenu.tsx  # [修改] admin 可见「系统管理」入口
```

---

### Task 1: `lib/adminApi.ts` — 管理域 API 与类型

**Files:**
- Create: `web/src/lib/adminApi.ts`

**Interfaces:**
- Consumes: `web/src/lib/api.ts` 的 `request<T>`、`DiagnosisResult` 类型（`getDiagnosis` 返回它）。
- Produces（后续所有页面任务的唯一数据入口；全部 `Promise`，错误统一 `ApiError`）:

```ts
export type Page<T> = { records?: T[]; total?: number; size?: number; current?: number; pages?: number }

export type AdminUser = {
  id: string; userAccount?: string; userName?: string; userAvatar?: string
  userProfile?: string; userRole?: string; createTime?: string
}
export function listUsers(q: { current: number; pageSize: number; userAccount?: string; userName?: string }): Promise<Page<AdminUser>>
export function deleteUser(id: string): Promise<boolean>

export type AdminNews = {
  id?: string; title?: string; author?: string; summary?: string
  content?: string; coverImage?: string; publishTime?: string
}
export function listAdminNews(q: { current: number; pageSize: number; title?: string }): Promise<Page<AdminNews>>
export function deleteNews(id: string): Promise<boolean>
export function getNews(id: string): Promise<AdminNews>
export function saveNews(body: { id?: string; title: string; content: string; status: number; coverImage?: string }): Promise<boolean>
export function uploadNewsCover(id: string, file: File): Promise<string>

export type AdminDiagnosis = {
  id: string; url?: string; username?: string; result?: string; confidence?: number
  severity?: string; reexamineStatus?: number; createTime?: string
  aiRejected?: boolean; abstainReason?: string; requiresReview?: boolean
}
export function listDiagnoses(q: { current: number; pageSize: number; result?: string; diagnosisTime?: string }): Promise<Page<AdminDiagnosis>>
export function getDiagnosis(id: string): Promise<DiagnosisResult>
export function submitReview(body: { id: string; humanResult: string; humanSeverity?: string; humanRecommendations?: string; humanReviewNote?: string }): Promise<boolean>
export function deleteDiagnosis(id: string): Promise<boolean>

export type KnowledgeDoc = {
  id: number; userId: number; title: string; fileName: string; fileUrl: string
  fileSize: number; fileType: string; chunkCount: number
  status: number; createTime: string; updateTime: string
}
export function uploadKnowledge(files: File[], title?: string): Promise<number[]>
export function listKnowledge(current: number, pageSize: number): Promise<Page<KnowledgeDoc>>
export function deleteKnowledge(id: number): Promise<boolean>
```

**端点对照（写死，勿改）：**

| 函数 | 端点 |
|---|---|
| listUsers | `POST /user/list/page/vo`（body 即 q） |
| deleteUser | `POST /user/delete/{id}` |
| listAdminNews | `POST /news/list/page/vo` |
| deleteNews | `POST /news/delete/{id}` |
| getNews | `GET /news/get/{id}` |
| saveNews | `POST /news/edit` |
| uploadNewsCover | `POST /news/uploadCover`（multipart：`file` + query `id`；`request` 不支持 FormData query，用 `fetch` 直连 `${BASE_URL}/news/uploadCover?id=${id}`，credentials include，信封手解——参考 `lib/api.ts` 的 `uploadPicture` 若有 FormData 先例则跟随） |
| listDiagnoses | `POST /diagnosis/list/page/vo` |
| getDiagnosis | `GET /diagnosis/get/{id}` |
| submitReview | `POST /diagnosis/update` |
| deleteDiagnosis | `POST /diagnosis/delete/{id}` |
| uploadKnowledge | `POST /knowledge/upload`（multipart `files` 多文件 + 可选 `title`） |
| listKnowledge | `POST /knowledge/list/page`（body `{current, pageSize}`） |
| deleteKnowledge | `DELETE /knowledge/delete`（body `{id}`） |

- [ ] **Step 1: 实现** `adminApi.ts`——薄封装，每个函数一行 `request<T>(...)`；类型如上逐字段照抄。无业务逻辑。
- [ ] **Step 2: 验证** — `npm run typecheck` 通过（无独立单测：纯转发无分支）。
- [ ] **Step 3: Commit** — `feat(web): 管理域 API 层 adminApi`

### Task 2: `lib/adminDomain.ts` — 纯函数（TDD）

**Files:**
- Create: `web/src/lib/adminDomain.ts`
- Test: `web/src/lib/adminDomain.test.ts`

**Interfaces:**
- Consumes: `Risk`（`@/lib/domain`）、`AdminUser`/`AdminDiagnosis`（Task 1）。
- Produces:

```ts
import type { Risk } from "@/lib/domain"
import type { AdminDiagnosis, AdminUser } from "@/lib/adminApi"

/** 复审状态 → 标签与风险档。优先级：aiRejected > requiresReview > reexamineStatus。 */
export function reviewView(rec: Pick<AdminDiagnosis, "reexamineStatus" | "requiresReview" | "aiRejected">): { label: string; risk: Risk; tone: "ai" | "review" | "plain" }
// aiRejected=true → { label:"AI 拒识", risk:"critical", tone:"ai" }
// requiresReview=true → { label:"待人工复核", risk:"attention", tone:"review" }
// reexamineStatus 1 → { label:"未复审", risk:"attention", tone:"plain" }
// reexamineStatus 2 → { label:"复审中", risk:"attention", tone:"plain" }
// reexamineStatus 3 → { label:"已复审", risk:"normal", tone:"plain" }
// 缺省/0 → { label:"未复审", risk:"attention", tone:"plain" }

/** 用户删除守卫：目标是 admin 不给删（修正 Vue 版写反的守卫）。 */
export function canDeleteUser(target?: AdminUser | null): boolean

/** 新闻正文长度守卫：后端 content.substring(0,30) 对 <30 字抛异常。按原始长度（不 trim）。 */
export function newsContentValid(content: string): boolean  // content.length >= 30

export type Ranked = { name: string; value: number; share: number }
/** 分布排序：value 降序，share = value/total（total 0 时 share 全 0）。 */
export function rankDistribution(rows: { name: string; value: number }[]): Ranked[]

/** 横条内标签放得下吗：估计宽 = 名称字符数 × 12px + 16px 内边距，超过条宽则放不下。 */
export function barLabelFits(barWidthPx: number, label: string): boolean
```

- [ ] **Step 1: 写失败测试** `adminDomain.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import { barLabelFits, canDeleteUser, newsContentValid, rankDistribution, reviewView } from "./adminDomain"

describe("reviewView", () => {
  it("aiRejected 优先于一切", () => {
    expect(reviewView({ reexamineStatus: 3, requiresReview: true, aiRejected: true })).toEqual({
      label: "AI 拒识", risk: "critical", tone: "ai",
    })
  })
  it("requiresReview 次之", () => {
    expect(reviewView({ reexamineStatus: 1, requiresReview: true, aiRejected: false }).label).toBe("待人工复核")
  })
  it("reexamineStatus 1/2/3/缺省", () => {
    expect(reviewView({ reexamineStatus: 1, requiresReview: false, aiRejected: false }).label).toBe("未复审")
    expect(reviewView({ reexamineStatus: 2, requiresReview: false, aiRejected: false }).label).toBe("复审中")
    expect(reviewView({ reexamineStatus: 3, requiresReview: false, aiRejected: false })).toEqual({
      label: "已复审", risk: "normal", tone: "plain",
    })
    expect(reviewView({ requiresReview: false, aiRejected: false }).label).toBe("未复审")
  })
})

describe("canDeleteUser", () => {
  it("目标是 admin → 不给删", () => {
    expect(canDeleteUser({ id: "1", userRole: "admin" })).toBe(false)
  })
  it("目标是普通用户 → 可删", () => {
    expect(canDeleteUser({ id: "2", userRole: "user" })).toBe(true)
  })
  it("目标缺失 → 不给删", () => {
    expect(canDeleteUser(null)).toBe(false)
    expect(canDeleteUser(undefined)).toBe(false)
  })
})

describe("newsContentValid", () => {
  it("29 字拦 / 30 字放", () => {
    expect(newsContentValid("字".repeat(29))).toBe(false)
    expect(newsContentValid("字".repeat(30))).toBe(true)
  })
  it("不 trim——29 字加空白仍拦", () => {
    expect(newsContentValid("字".repeat(29) + "  ")).toBe(false)
  })
})

describe("rankDistribution", () => {
  it("降序 + 占比", () => {
    const rows = rankDistribution([
      { name: "白内障", value: 484 },
      { name: "正常", value: 1048 },
      { name: "青光眼", value: 300 },
    ])
    expect(rows[0].name).toBe("正常")
    expect(rows[0].share).toBeCloseTo(1048 / 1832, 5)
    expect(rows[2].name).toBe("青光眼")
  })
  it("total 0 → share 全 0，不产生 NaN", () => {
    expect(rankDistribution([{ name: "A", value: 0 }])[0].share).toBe(0)
  })
})

describe("barLabelFits", () => {
  it("长名窄条放不下", () => {
    expect(barLabelFits(60, "高血压性视网膜病变")).toBe(false)
  })
  it("短名宽条放得下", () => {
    expect(barLabelFits(400, "正常")).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run src/lib/adminDomain.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现** `adminDomain.ts`（签名与规则照上；`barLabelFits` 用 `label.length * 12 + 16 <= barWidthPx`）。
- [ ] **Step 4: 跑测试确认通过** — `npx vitest run src/lib/adminDomain.test.ts` → PASS；`npm run typecheck` 通过。
- [ ] **Step 5: Commit** — `feat(web): 管理域纯函数 adminDomain（复核映射/删除守卫/摘要校验）`

### Task 3: 图表令牌 + 外壳（AdminLayout / AdminGate / 路由 / 入口）

**Files:**
- Modify: `web/src/styles/tokens.css`（`:root` 追加 2 行；`html.dark` 块追加 2 行）
- Modify: `web/src/index.css`（`@import "./styles/admin.css";`）
- Create: `web/src/styles/admin.css`（本任务只写外壳段：`.admin-shell/.admin-beam/.admin-side/.admin-main`）
- Create: `web/src/components/admin/AdminLayout.tsx`
- Create: `web/src/components/admin/AdminGate.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/AccountMenu.tsx`

**Interfaces:**
- Produces:
  - `AdminGate`（无 props，children 包裹）：读 `useSession()`；`status==="loading"` → 渲染占位不发请求；`anon` → 渲染全站空态（API 探测时 40100 会经 AuthRedirect 跳登录，此处兜底渲染无权限说明页）；`authed && user.userRole!=="admin"` → 无权限说明页（自绘：overline「ACCESS DENIED」、说明文、回首页按钮）；admin → `{children}`。
  - `AdminLayout`：仪表梁（`← 返回主站` Link to `/`、铭牌「眼瞳 IRIS · 系统管理 / ADMINISTRATION」、右侧账号名 + 主题切换）+ 左侧栏（`ADMIN_NAV` 导出供测试/复用）+ `<Outlet />`。`ADMIN_NAV = [{ to:"/admin/dashboard", code:"01", label:"仪表盘" }, users 02 用户管理, news 03 新闻管理, diagnosis 04 诊断管理, knowledge 05 知识库, data-analysis 06 数据分析]`。
  - 路由树（App.tsx 内，置于现有路由之后）：

```tsx
<Route path="/admin" element={<AdminGate><AdminLayout /></AdminGate>}>
  <Route index element={<Navigate to="/admin/dashboard" replace />} />
  <Route path="dashboard" element={<AdminDashboardPage />} />
  {/* users/news/diagnosis/knowledge/data-analysis/news/:id/edit 同构；页面组件 Task 6-12 落地，
      本任务先用 web/src/components/PlaceholderPage.tsx 占位（code 06-09 编号顺延），
      占位不影响路由与守卫验收 */}
</Route>
```

  - AccountMenu：菜单内 `user.userRole === "admin"` 时渲染 `<Link className="acct__item" to="/admin">系统管理</Link>`（置于「个人中心」之上）。
  - tokens.css 追加（值勿改）：`:root` 内 `--viz-accent: #d9541f; --viz-mute: #8b9195;`；`html.dark` 内 `--viz-accent: #d9591f; --viz-mute: #767d79;`。

- [ ] **Step 1: 实现**全部文件（AdminLayout 侧栏当前项用 `NavLink` 的 `aria-current="page"` + 信号橙短竖线；窄屏 ≤768px 侧栏变横向标签条，media query 写在 admin.css）。
- [ ] **Step 2: 验证** — `npm run typecheck` 通过；`npm run dev` 起服务后人工核对：① 匿名访问 `/admin` 兜底无权限页（未跳转，因 session 探测 silentAuth）；② 登录 admin 账号可见侧栏 6 项与占位页、AccountMenu 出现「系统管理」；③ 登录普通账号只见无权限说明页且无入口。
- [ ] **Step 3: Commit** — `feat(web): admin 外壳——仪表梁布局、AdminGate 守卫、路由与入口`

### Task 4: 表格与弹层原语

**Files:**
- Create: `web/src/components/admin/DataTable.tsx`
- Create: `web/src/components/admin/Toolbar.tsx`
- Create: `web/src/components/admin/StatTile.tsx`
- Create: `web/src/components/admin/Modal.tsx`
- Create: `web/src/components/admin/Drawer.tsx`
- Modify: `web/src/styles/admin.css`（原语段样式）

**Interfaces:**
- Produces（Task 6-12 全部消费）:

```ts
export type Column<T> = {
  key: string
  title: string
  width?: string
  align?: "left" | "right" | "center"
  mono?: boolean          // 该列数值用 .num
  render?: (row: T) => ReactNode
}
export function DataTable<T>(props: {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  loading?: boolean
  error?: string | null
  emptyText?: string
  page: { current: number; pageSize: number; total: number }
  onPageChange: (next: { current: number; pageSize: number }) => void
}): ReactElement

export function Toolbar(props: { children: ReactNode }): ReactElement
export function StatTile(props: {
  label: string
  value: string            // 已格式化字符串（含千分位），调用方负责
  delta?: string           // 如 "↑12.5%"，仅展示
  accent?: boolean         // 首块强调
}): ReactElement

export function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }): ReactElement
export function Drawer(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }): ReactElement
```

- Modal/Drawer 行为硬性要求：`open` 受控；Esc 关闭；遮罩点击关闭；开启时焦点移入、关闭时归还触发元素；`role="dialog"` + `aria-modal`；内容区可滚动。遮罩复用 `.scrim` 词汇类。
- DataTable：语义化 `<table>`；表头 mono 小写间距字（`--fg-3`）；行间 `--hr` 发丝线；加载/错误/空三态占行（错误文案来自调用方传的 `describeError` 结果）；分页条「`第 X / Y 页 · 共 N 条` 上一页/下一页/每页条数」，全部 mono。
- [ ] **Step 1: 实现**五个组件 + admin.css 原语段。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工：临时在占位页挂一个 Modal + DataTable 造数据，核对 Esc/遮罩/焦点归还/三态/分页，撤掉临时代码。
- [ ] **Step 3: Commit** — `feat(web): admin 原语——DataTable/Toolbar/StatTile/Modal/Drawer`

### Task 5: SVG 图表组件

**Files:**
- Create: `web/src/components/admin/charts/TrendChart.tsx`
- Create: `web/src/components/admin/charts/MiniTrend.tsx`
- Create: `web/src/components/admin/charts/MiniBars.tsx`
- Create: `web/src/components/admin/charts/RankedBars.tsx`
- Modify: `web/src/styles/admin.css`（图表段样式）

**Interfaces:**
- Consumes: `Ranked`（Task 2 `rankDistribution` 的产物）、`barLabelFits`。
- Produces:

```ts
export function TrendChart(props: { points: { label: string; value: number }[]; ariaLabel: string }): ReactElement
// 2px 折线（--viz-accent）+ 10% 面积淡填 + 十字准线 tooltip（跟随最近数据点，列出 label+value）
// 端点直标最后一个值；Y 轴 3-5 条发丝网格（实线，--hr）；无图例。悬停命中区=整列宽。

export function MiniTrend(props: { title: string; points: number[] }): ReactElement
// 小倍数单元格：标题（--fg-2 小字）+ 无轴迷你折线（--viz-mute，末点 --viz-accent 标记）+ 末值 mono。

export function MiniBars(props: { title: string; bars: { label: string; value: number }[] }): ReactElement
// 小倍数单元格：7 根柱，柱宽 ≤24px、数据端 4px 圆角基线方角，单色 --viz-mute，最大值柱 --viz-accent。

export function RankedBars(props: { rows: Ranked[]; ariaLabel: string }): ReactElement
// 排序横条：名称（--fg-2）+ 刻度轨横条（--viz-accent）+ 数值与占比 mono（--fg）。
// barLabelFits(barWidth, name) 为 false 时不把名称放进条内——名称恒在条外左侧（本设计不出现条内标签）。
```

硬性要求（dataviz）：网格/轴一律 1px 实线发丝（禁虚线）；文字不穿数据色（轴刻度/数值用 `--fg/--fg-2/--fg-3`）；每张 TrendChart/RankedBars 提供「图 / 表」切换（mono 读数表，tooltip 不得是唯一读数通道）；键盘 focus 与 hover 同效（准线切换用 onFocus/onBlur + 方向键移点）；尺寸含轴标签带，容器不裁轴。

- [ ] **Step 1: 实现**四个组件 + 样式。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工：mock 数据挂临时路由核对折线准线/端点直标/表切换、横条排序、两个主题各看一遍（Review Focus #4），撤临时代码。
- [ ] **Step 3: Commit** — `feat(web): admin SVG 图表——TrendChart/MiniTrend/MiniBars/RankedBars`

### Task 6: 仪表盘页（mock）

**Files:**
- Create: `web/src/pages/admin/AdminDashboardPage.tsx`

**Interfaces:**
- Consumes: `SectionHead`（`@/components/SectionHead`）、`StatTile`（Task 4）、`TrendChart`/`RankedBars`（Task 5）、`DataTable`（Task 4）、`rankDistribution`（Task 2）。
- Mock 数据（spec §5.6 数值照搬 Vue 版，病种换八类）：KPI `[{诊断总次数,"5,632",↑12.5%,accent},{用户总数,"1,284"},{今日新增,"47"},{知识库文件,"126"}]`；近 7 天趋势 `[62,78,53,91,84,47,65]`（周一~周日）；疾病分布（RankedBars 6 类）：`正常 1048 / 白内障 735 / 青光眼 580 / 糖尿病视网膜病变 484 / AMD 300 / 其他 200`；最近诊断记录 5 条：`张三/正常/0.95、李四/白内障/0.87、王五/正常/0.99、赵六/青光眼/0.76、孙七/糖尿病视网膜病变/0.82`（时间 2026-04-23 14:32 起递减）。
- [ ] **Step 1: 实现**页面（右上角「示例数据 · SAMPLE」mono 小标；置信度列 mono 百分号一位小数）。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工：`/admin/dashboard` 两主题截图对照 spec §5.6。
- [ ] **Step 3: Commit** — `feat(web): admin 仪表盘页（示例数据，八类病种）`

### Task 7: 用户管理页

**Files:**
- Create: `web/src/pages/admin/AdminUsersPage.tsx`

**Interfaces:**
- Consumes: `listUsers`/`deleteUser`（Task 1）、`canDeleteUser`（Task 2）、`DataTable`/`Toolbar`/`Modal`（Task 4）、`describeError`（`@/lib/api`）。
- 页面行为：搜索（userAccount/userName 模糊，回车或按钮触发，重置清空回第 1 页）；列 `id(mono)/账号/用户名/头像(img 32px 圆)/简介/角色/创建时间/操作`；角色标签 risk 风格 + 文字：`admin→「管理员」attention 档 / user→「普通用户」normal 档 / ban→「已封禁」critical 档`；删除走 `canDeleteUser` 守卫，目标是 admin 时按钮禁用 + title「无法操作管理员账号」，确认弹 Modal，成功后刷新当前页。
- [ ] **Step 1: 实现**。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工（后端起着）：分页/搜索/重置；删普通用户成功刷新；admin 行按钮禁用；未登录态访问时 40100 跳登录带 redirect 回跳（Review Focus #1）；grep 确认无 `Number(` 作用于 id（Review Focus #3）。
- [ ] **Step 3: Commit** — `feat(web): admin 用户管理页（真实端点 + 删除守卫修正）`

### Task 8: 新闻管理页

**Files:**
- Create: `web/src/pages/admin/AdminNewsPage.tsx`

**Interfaces:**
- Consumes: `listAdminNews`/`deleteNews`（Task 1）、`DataTable`/`Toolbar`/`Modal`（Task 4）、`useNavigate`。
- 列 `id(mono)/标题/摘要（截 40 字）/作者/发布时间/操作`；搜索 title 模糊；操作 = 编辑（`navigate('/admin/news/' + id + '/edit')`）+ 删除（Modal 确认）；右上「新建」按钮 → `navigate('/admin/news/new/edit')`。雪花 id 全程 string（Review Focus #3）。
- [ ] **Step 1: 实现**。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工：列表/搜索/删除/跳编辑页；雪花 id 显示完整且删除请求路径正确（Network 面板核对）。
- [ ] **Step 3: Commit** — `feat(web): admin 新闻管理页（真实端点）`

### Task 9: 诊断管理页

**Files:**
- Create: `web/src/pages/admin/AdminDiagnosisPage.tsx`

**Interfaces:**
- Consumes: `listDiagnoses`/`getDiagnosis`/`submitReview`/`deleteDiagnosis`（Task 1）、`reviewView`（Task 2）、`DataTable`/`Toolbar`/`Modal`/`Drawer`（Task 4）、`RiskTag`（`@/components/RiskTag`）、`severityLabel`/`formatTimestamp`/`fixed`（`@/lib/domain`）、`DiagnosisResult`（`@/lib/api`）。
- 列（**按真实 VO 字段，spec §5.3**）：`id(mono)/诊断图像(缩略图 48px)/用户(username)/结果(result)/置信度(confidence mono %)/复审状态(reviewView → RiskTag)/时间(createTime)/操作`。搜索：疾病名 result 模糊；AI 拒识行 result 为空 → 显示「—」+ 拒识原因摘要。
- 详情 Drawer：行点击开，内容 `getDiagnosis(id)` 全量（复用 `DiagnosisResult` 字段排版：图、结果、置信度、建议分行、modelVersion、abstainReason），Drawer 底部「人工复核」按钮开复核 Modal。
- 复核 Modal：字段 `humanResult(必填 textarea)/humanSeverity(select：NOT_ASSESSED 未评估/normal 正常/low 低风险/medium 中风险/high 高风险)/humanRecommendations/humanReviewNote`；humanResult 空时禁提交并提示；提交 `submitReview`，成功关弹层刷新当前页。AI 字段不可编辑（界面上无这些输入）。
- 删除：操作列按钮 + Modal 确认。
- 页脚小字：「列出的是你名下的判读记录（后端数据边界，见 spec §7）」。
- [ ] **Step 1: 实现**。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工：列表分页搜索；Drawer 打开详情；复核提交后复审状态变「已复审」；空 humanResult 禁提交；grep 无 `Number(` 作用于 id（Review Focus #3）。
- [ ] **Step 3: Commit** — `feat(web): admin 诊断管理页（真实 VO 字段 + 人工复核）`

### Task 10: 知识库页

**Files:**
- Create: `web/src/pages/admin/AdminKnowledgePage.tsx`

**Interfaces:**
- Consumes: `uploadKnowledge`/`listKnowledge`/`deleteKnowledge`（Task 1）、`KnowledgeDoc`（Task 1）、`DataTable`/`Toolbar`/`Modal`（Task 4）、`RiskTag`、`formatTimestamp`。
- 行为（spec §5.4，保留 Vue 版轮询机制）：工具栏「选择文件」（多选，进待传列表）+「开始上传」；上传成功 → 清待传、刷新列表、处理中队列显示文件名；**轮询**：列表存在 `status===0` 时 3 秒 `setInterval` 重拉，无则停；组件卸载清定时器；重复调用防重入（已有 timer 不再起）。列 `文件名/类型/大小(B/KB/MB)/分块数(mono)/状态(0→「处理中」attention / 1→「已完成」normal / 2→「失败」critical，RiskTag+文字)/上传时间/操作(删除)`。页脚小字同 Task 9（数据边界）。
- [ ] **Step 1: 实现**。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工：上传一个 txt/md，观察「处理中→已完成」自动刷新且轮询停止（Review Focus #2）；离开页面 Network 无请求继续；删除成功刷新。
- [ ] **Step 3: Commit** — `feat(web): admin 知识库页（上传/轮询/删除）`

### Task 11: 数据分析页（mock）

**Files:**
- Create: `web/src/pages/admin/AdminDataAnalysisPage.tsx`

**Interfaces:**
- Consumes: `StatTile`、`Toolbar`、`MiniTrend`/`MiniBars`/`RankedBars`（Task 5）、`rankDistribution`（Task 2）。
- Mock 数据（spec §5.6）：KPI `总诊断数 8,452 ↑12.5% / 确诊数 7,891 ↑8.2% / 准确率 98.7% ↑0.5% / 平均诊断速度 2.3s ↓15.4%（trendLabel「较上月优化」）`；12 月 6 病种小倍数（MiniTrend 3×2：糖尿病视网膜病变/白内障/青光眼/AMD/病理性近视/正常，各 12 点，照搬 Vue 版数值换名）；疾病分布 10 类 RankedBars：`糖尿病视网膜病变 1048 / 白内障 735 / 青光眼 580 / AMD 484 / 病理性近视 300 / 正常 251 / 高血压性视网膜病变 198 / 其他 102 / 角膜炎 98 / 结膜炎 70`；按周活跃 3 小倍数柱图（在线诊断/报告查看/数据导出，各 7 柱照搬 Vue 数值）。Toolbar 内时间范围 select（7/30/90 天，装饰性不真过滤）。
- [ ] **Step 1: 实现**。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工：两主题对照 spec §5.6；小倍数 3×2 排布与末值显示。
- [ ] **Step 3: Commit** — `feat(web): admin 数据分析页（示例数据，小倍数形式）`

### Task 12: 新闻编辑页

**Files:**
- Create: `web/src/pages/admin/AdminNewsEditPage.tsx`

**Interfaces:**
- Consumes: `getNews`/`saveNews`/`uploadNewsCover`（Task 1）、`newsContentValid`（Task 2）、`Modal`、`renderMarkdown`（`@/lib/markdown.ts`，预览直接 innerHTML——markdown.ts 内已含 DOMPurify）。
- 页面行为：路由 `/admin/news/:id/edit`，`id==="new"` 为新建。加载：编辑模式 `getNews(id)` 填 `title/content`；新建模式空表单。字段：标题 input、正文 textarea（min-height 420px，等宽不适用——正文用 `--font-sans`）、状态 select（0 草稿/1 已发布/2 下架）、封面（编辑模式显示现图 + 更换/清除；**新建模式按钮禁用 + 提示「保存后可上传封面」**）。顶栏「编辑 / 预览」切换（预览 = `renderMarkdown(content)` 渲染于 `.markdown-body`）。
- 保存：`newsContentValid` 不过 → 阻止并提示「正文至少 30 字（后端以正文前 30 字生成摘要）」；过 → `saveNews({ id: isNew?undefined:id, title, content, status, coverImage })`；**新建成功后 `navigate('/admin/news/' + 返回?拿不到 id)`——后端 saveOrUpdate 返回 boolean 不回 id，处理：新建成功后提示「已创建，请在列表打开继续编辑封面」并跳回 `/admin/news`**（不能猜 id）。编辑模式成功提示并留在本页。
- 封面上传（编辑模式）：JPG/PNG ≤5MB 预检（超限提示，沿用 Vue 版规则文案），`uploadNewsCover(id, file)` 成功后更新表单 coverImage 并显示新图。
- [ ] **Step 1: 实现**。
- [ ] **Step 2: 验证** — `npm run typecheck`；人工：编辑现有新闻改标题/正文保存后列表可见；29 字拦 30 字放（Review Focus #5）；新建流程走通并回到列表；封面更换生效；预览渲染与判读页 markdown 一致。
- [ ] **Step 3: Commit** — `feat(web): admin 新闻编辑页（textarea+预览，封面与摘要守卫）`

### Task 13: 全站验收与留档

**Files:**
- Modify: 无新代码；发现问题则回修对应任务文件。
- 产出: `web/.shots/admin-*.png` 截图。

- [ ] **Step 1: 双主题全走查** — 浅色+暗色各走一遍 6 页 + 编辑页 + 无权限页；核对图表（Review Focus #4）、表格三态、弹层。
- [ ] **Step 2: 窄屏走查** — 375px 与 768px：侧栏折叠为横向标签条、表格横向滚动、图表不溢出。
- [ ] **Step 3: 守卫走查** — 匿名直输 `/admin/users`（session 探测 silent，页面兜底无权限态）、登录普通用户访问（无权限说明页）、admin 全通（Review Focus #1）。
- [ ] **Step 4: 截图留档** — 关键页面存 `web/.shots/admin-dashboard-light.png` 等（每页浅/暗各一张 + 无权限页 + 窄屏一张）。
- [ ] **Step 5: 收尾提交** — 如有回修，按域分 commit；无回修则本任务无 commit。

---

## Self-Review 记录

- **Spec 覆盖**：spec §2 路由/守卫→Task 3；§3 目录→各任务；§4.2 图表令牌→Task 3（tokens.css）/Task 5（消费）；§4.3 图表规范→Task 5；§5.1-5.6 逐页→Task 6-12；§6 组件契约→Task 4；§7 数据边界→Task 9/10 页脚小字 + 开票在 spec 内（不动后端）；§8 修正清单→Task 2（守卫/摘要）/Task 7（守卫消费）/Task 9（VO 字段）/Task 12（摘要拦截）；§9 测试→Task 2 + 各任务人工步骤 + Task 13；§10 非目标未引入。AccountMenu 入口（spec §2）→Task 3。
- **步骤扫描**：每步一个动作；实现步骤只钉签名/数值/端点，函数体由实现者写；无 TBD。
- **类型一致性**：`Page<T>`、`Ranked`、`Column<T>`、`reviewView` 返回 `{label,risk,tone}`、`rankDistribution` 产 `Ranked[]` 供 `RankedBars`——Task 2/4/5 与消费任务引用同名。
- **Review Focus**：5 条各有钉住位置（Task 3 / 10 / 8+9 / 5+13 / 2+12）。
- **比例**：计划约与 spec 等长，代码块仅为签名/测试/端点表，无函数体转写。

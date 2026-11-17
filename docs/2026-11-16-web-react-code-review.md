# `web/` React 前端代码评审报告

> 日期：2026-11-16 　基线：`ui` 分支 `9d3c5317`（工作区干净）
> 范围：`web/` 全部 React/TS 源码、样式层、依赖与构建配置
> 方法：5 个子代理按场景并行审查，准则取自 `/vercel-react-best-practices`（70 条规则，逐条引用规则文件）与 `/tailwind-design-system`（Tailwind v4 令牌 / 架构）；主会话对高影响结论逐条抽查复核
> 性质：**只读审查**，未修改任何源码；`vite build` 产物落在 gitignored 的 `web/dist`
> 与 UI 冻结的关系：本报告只提代码级改进；凡产生视觉 delta 的建议均标注 `[视觉·冻结阻塞]`

---

## 处理状态（2026-11-16 更新）

| 批次 | 范围 | 状态 |
|---|---|---|
| P0-1 | `applyStreamEvent` 就地改写 state | 已修（`b067efe0`，含 3 条回归测试） |
| 首屏三项 | 光幕图 preload、字体去重、latin 子集 | 已修（`1a4df433`） |
| 其余 P1 / P2 | 见下方各节 | 已修于 `fix/frontend-review-20261116`（`eed44852`…`368583c3`） |
| 独立复审 | 对本分支再跑一轮 `/code-review` 的 6 条发现 | 1 条已修于 `77e43f6c`，其余 5 条见下 |

逐条对账、验证读数与**未做项的理由**见交接文档
`D:\Work\code\iris-integration-handoff\iris-frontend-fix.md`。

仍未处理、需要单独一批的：M-1（筛选草稿 state 下沉）、M-2（`columns` 稳定化）、
B-1（`@base-ui/react` 首屏拆包，报告本身就要求单独 PR）、§4.4 卡片化块收敛、
§4.5 组件令牌集中与 `:hover` 门控；`[视觉·冻结阻塞]` 各项登记 Issue #84。

### 视觉复核（2026-11-17）

修复批次按「零视觉 delta」设计，但代码层自证不了这一点：用无头浏览器把修复
分支与冻结基线 `ui`@`cf9e9351` 逐页对照——浅色 / 暗色 × 桌面 1440 / 窄屏 820 /
`prefers-reduced-motion`，共 61 张截图做像素级比对。

首轮查出 **1 处真实视觉回归**：`--col-w` 重构里 `.admin-dt__head` 的
`width: var(--col-w, auto)` 把没声明列宽的勾选列一起改了；勾选列变 `auto` 后
在 `table-layout:fixed` 下吸走整表富余宽度，数据列缩成名义宽度——用户管理与
诊断管理的宽表整张向右歪、账号 id 被截断（差异 4.0% / 3.3% 像素）。已修
（`77e43f6`：列宽规则只作用于声明了列宽的表头，勾选列回到 40px 定宽）。

复核后 61 张与基线逐像素一致；唯一残差是远程头像位图的解码噪声（61 px，
阈值 12/255），非布局差异。

### 独立复审整改（2026-11-17，PR #92 draft）

对 `fix/frontend-review-20261116` 另跑一轮独立 `/code-review`，6 条发现里
1 条已在 `77e43f6c` 修掉（勾选列宽度），其余 5 条在本批修掉：

| 发现 | 位置 | 处理 |
|---|---|---|
| 聚合读不出来时统计显示 0，副标题却写「按当前页」 | `ProfilePage.tsx` | 退回本页汇总（口径标 page），两个来源都没读数才显示「—」；`loadMyStats` 那段死代码换成纯函数 `resolveScopedStats`，`RecordsPage` 一并复用 |
| 加载骨架没有列身份 | `DataTable.tsx` | 骨架 `<td>` 补 `data-col`，窄屏卡片化不再在加载瞬间错位 |
| 防抖草稿在刷新/关页时丢 | `ChatInput.tsx` | 补 `pagehide` 兜底（卸载只覆盖「组件被拆掉」） |
| 离开棱镜后 hover 态卡住 | `Prism.tsx` | `pointerleave` 取消已排队的 rAF |
| 测试只覆盖死代码 | `records.test.ts` | 载荷校验用例移到 `loadServerStats`，合成用例给 `resolveScopedStats` |

验证：`typecheck` / `lint` / `test`（53 文件 470 例全绿）/ `build` 全过；
入口 JS 仍是 474.84 kB（gzip 154.60 kB），与上一批一致。

**视觉 delta**：个人中心那条口径提示的文案改了（原来写「服务端聚合上线后会自动
切到全量」，而聚合接口已经上线），只出现在聚合不可用时；冻结基线的 61 张逐像素
证据要为这一页重跑一次。

### 第二轮整改（2026-11-17，外部复审意见）

复审提了 1 条 P1 与 3 条 P2，逐条处理：

| 条目 | 处理 |
|---|---|
| **P1** 个人中心统计降级是真实回归：聚合接口 404 时显示 0，而原实现会退回本页汇总 | 已在上一批修掉（`47e1c2f`）：退回本页汇总、口径标 page，两个来源都没读数才显示「—」。本批把回归用例改成复审给的那一幕（聚合 404、列表 37 条且近 10 条里 2 条高风险，断言页面显示 37 与 2，不是 0） |
| **P2-A** `components.json` 被删、shadcn 仍留在 devDependencies，组件生成流程不完整 | 恢复 `web/components.json`（style `base-nova`、`iconLibrary: lucide`、alias 指向 `@/components` 与 `@/lib/utils`），并补回 CLI 的落点 `src/lib/utils.ts`（只一个 `cn`，不引 clsx / tailwind-merge）。决策写进 `web/DESIGN.md` 规则 18：组件底座是 Base UI 薄封装，`components.json` 是**生成约束**不是现状 |
| **P2-B** 统计查询键带页码，翻页会为同一个账号级统计建新键 | 新增 `queryKeys.records.stats(scope)`，个人中心与记录页共用同一份缓存；键里保留 scope，账号隔离不变 |
| **P2-C** 宽表回归只有人工测量与截图，没有可长期跑的断言 | 新增 `web/e2e/admin-columns.spec.ts`：用户管理与诊断管理两页的列几何断言（份额 = 声明份额、勾选列不吸富余、操作列贴右、份额不随视口漂移）。不需要后端与账号（会话与列表在测试内拦截）。断的是**份额**不是像素——`table-layout: fixed` 下富余宽度本来就按声明宽度等比分摊 |

几何断言的有效性是验过的：把 `77e43f6c` 的修复临时回退，两条用例都变红
（勾选列实际拿到 19.6% / 9.1%，声明只有 5.4% / 4.2%）；恢复后全绿。

验证：`typecheck` / `lint` / `test`（53 文件 470 例全绿）/ `build` 全过；
`check:e2e-fixme`（0 隔离）与 `check:gate-tests` 通过；入口 JS 仍 474.84 kB
（gzip 154.60 kB）。

---

## 0. 一句话结论

构建健康、路由分包正确、令牌纪律在新增代码里守得住；**没有阻断性架构问题**。但有 **1 个真实的功能性 bug**，以及三个共性根因：缺 memo 边界导致的渲染扇出、首屏静态引入纯交互依赖、设计系统两套体系并行无桥。

---

## 1. 结论摘要

### 1.1 分级统计

| 级别 | 数量 | 说明 |
|---|---|---|
| **P0** | 1 | 工具调用卡片可能整条不渲染 / StrictMode 下重复渲染 |
| **P1** | 20 | 性能瓶颈、首屏体积、结构性设计系统风险 |
| **P2** | 37 | 局部优化、技术债、防回归 |

### 1.2 三个共性根因

| 根因 | 表现 | 波及面 |
|---|---|---|
| **缺 memo 边界** | `messages` 挂在 `AgentPage` 根部，每片 token 重渲染整棵三栏；全仓 `memo(` 仅 1 处，`startTransition` / `useDeferredValue` 零使用 | Agent、管理端四页、落地页 |
| **首屏静态引入纯交互依赖** | `@base-ui/react` 50.2 kB gzip（占首屏 JS gzip 的 29%），只服务两个首屏不渲染的弹层/菜单；两张主题底图 333 kB 在**每个路由**预载 | 全站首屏 |
| **设计系统两套体系并行无桥** | Tailwind v4 只作引擎，全站真正用到的 utility 只有 `sr-only`（7 次）；令牌对 utility 层不可见，且手写 CSS 无层、永远压过 `utilities` 层 | 后续任何 utility 引入都会静默失效 |

### 1.3 收益排序（前 5）

| # | 动作 | 收益 | 成本 | 风险 |
|---|---|---|---|---|
| 1 | 延迟加载 `@base-ui/react` | 首屏 JS **−50.2 kB gzip（−29%）** | 两处 lazy | 中（改首屏装配方式） |
| 2 | 删两张光幕图的 `preload` | 全站 **−333 kB**，落地页 −143～190 kB | 一行 HTML | 极低 |
| 3 | Agent 流式加 memo 边界 | 每片 token 从 O(消息数) → O(1) | 约 25 行 | 极低 |
| 4 | 修 `applyStreamEvent` 的引用突变 | 消除一个功能性 bug | 约 10 行 | 极低 |
| 5 | 管理端筛选草稿 state 下沉 | 每键渲染约 90 个组件实例 → 0 | 四页同构改造 | 低 |

---

## 2. P0 · 正确性（1 条）

### P0-1 `applyStreamEvent` 在 updater 里就地改写上一份 state，工具卡可能整条不渲染

> **状态：已修复（2026-11-16）**。`tool-request` 分支改为构造新数组，并补了三条回归用例
> （首个事件即 tool-request / reasoning 后紧跟 tool-request / StrictMode 双调用）。
> 见 `web/src/lib/agentStream.ts` 与 `web/src/lib/agentStream.test.ts`。以下保留原始分析。

**位置**：`web/src/lib/agentStream.ts:51-62`、`:98-117`（✅ 主会话逐行复核）

**现状**：

```ts
export function clearAllLoading(msgs: StreamMessage[]): StreamMessage[] {
  if (!msgs.some((m) => m.isLoading)) return msgs      // ← 同一引用
  return msgs.map((m) => (m.isLoading ? { ...m, isLoading: false } : m))
}

function truncate(msgs: StreamMessage[]): StreamMessage[] {
  return clearAllLoading(msgs)                        // ← 透传同一引用
}

case "tool-request": {
  const out = truncate(msgs)                          // 无 loading 时 out === msgs
  for (const tc of dto.toolCalls ?? []) {
    out.push({ id: newId(), type: "tool-request", ... })   // ← 就地 push 进旧 state
  }
  return out                                          // ← 返回同一个引用
}
```

**为什么是 bug**：

1. **触发条件常见**：`reasoning` 消息创建时不带 `isLoading`（`agentStream.ts:95`）。所以「若干 reasoning 片 → tool-request」或「流的第一条事件就是 tool-request」（模型直接发起 function call、不先说一句话）时，`msgs.some(m => m.isLoading)` 为 false，`truncate()` 原样返回。
2. **渲染被跳过**：`setMessages` 的 updater 返回上一份 state 的同一引用，React 用 eager-state + `Object.is` 比较会判定「状态没变」而直接 bail out，**不调度渲染**。卡片要等下一次别的 state 更新（例如随后到来的 `tool-response`）才补上；若流在 tool-request 之后直接结束，这张卡永远不出现。
3. **StrictMode 下重复**：`web/src/main.tsx:18` 开了 `<StrictMode>`，开发态 updater 被调用两次，两次都往同一个数组 push → 同一张工具卡渲染成两张。
4. 同时违反「updater 必须是纯函数、必须返回新对象」的约束。

**为什么现有测试没抓到**：两个 `tool-request` 用例前面都先发了一片 `assistant`，此时 `clearAllLoading` 走 `map` 分支返回新数组，push 落在新数组上。

**改法**：

```ts
case "tool-request": {
  const base = truncate(msgs)
  const added = (dto.toolCalls ?? []).map((tc) => {
    const name = tc.name || "工具"
    let parsedArgs: Record<string, unknown>
    try { parsedArgs = JSON.parse(tc.arguments || "{}") } catch { parsedArgs = { _raw: tc.arguments } }
    return {
      id: newId(), type: "tool-request" as const, content: "",
      toolName: name, toolCalls: [{ name, args: parsedArgs }],
    }
  })
  return added.length === 0 ? base : [...base, ...added]
}
```

**影响**：现有测试仍通过（断言的是长度与内容，不依赖引用）。**建议补一条回归用例**：首个事件即 `tool-request` 时，断言 `next !== prev` 且 `prev.length` 未变。纯代码改动，无视觉变化。

**规则**：`rerender-functional-setstate`

---

## 3. P1 · 性能

### 3.1 Agent 对话 / 流式子系统

> 主瓶颈不是 markdown，而是**渲染扇出**：一条 SSE 事件重渲染整棵三栏，而全仓库零 memo 边界。每片代价是 O(消息数 + 会话数)，不是 O(1)。

#### A-1 `MessageRow` 未 memo，且 `onPreviewImage` 每次新建

- **位置**：`web/src/components/agent/MessageList.tsx:15-32`、`:134-136`；`web/src/pages/AgentPage.tsx:363`
- **问题**：`MessageRow` 是普通函数组件，父级每次渲染都全部重跑。而**上游数据已经具备 memo 条件**——`applyStreamEvent` 的累加分支是 `[...msgs.slice(0, -1), { ...target, content }]`（`agentStream.ts:76-80`），`clearAllLoading` 的 `map` 对非 loading 项返回原对象（`:53`），历史消息的 `msg` 对象引用是稳定的。但 `AgentPage.tsx:363` 传的是内联箭头，每次渲染新引用，会把 memo 直接废掉。
- **改法**：`memo(MessageRow)`；`onPreviewImage` 直接传 `setPreviewUrl`（`Dispatch<SetStateAction<string>>` 可赋给 `(url: string) => void`，类型能过）。
- **影响**：每片 token 从 O(消息数) 降到 O(1)。约 5 行，行为零变化。
- **规则**：`rerender-memo`

#### A-2 `SessionList` 每片 token 全量重渲染

- **位置**：`web/src/components/agent/SessionList.tsx:22`（`groupSessions`）、`:123`、`:125`、`:301`（`renderRow`）；`web/src/pages/AgentPage.tsx:338-354`
- **问题**：左栏与流式内容毫无关系，但每片都要重跑：`groupSessions`（含 `new Date()` 与全表遍历）、`selectedIds` 的 filter+map、每个会话行的 `formatSessionStamp`（又一个 `new Date()`）、以及每个会话行的一整棵 Base UI `Menu`。50 个会话 × 每秒 30 片 ≈ 每秒 1500 次 `Date` 构造 + 1500 次 Menu 组件函数调用。`AgentPage` 里 4 个内联箭头使 `memo(SessionList)` 无法生效。
- **改法**：`useMemo(() => groupSessions(sessions), [sessions])`；`selectedIds` 同样 `useMemo`；`export const SessionList = memo(...)`；4 个内联箭头提成 `useCallback`。
- **影响**：左栏完全移出流式路径。约 20 行。
- **规则**：`rerender-split-combined-hooks` / `rerender-memo`

#### A-3 滚动跟随每片强制一次同步回流

- **位置**：`web/src/components/agent/MessageList.tsx:85-103`
- **问题**：两个 effect 都在读 `scrollHeight` 后写 `scrollTop`，布局脏时读即强制 reflow；且依赖 `lastContent` 意味着每片 token 触发一次。
- **改法**：合并成一个 `followBottom`，用 `requestAnimationFrame` 合帧，卸载时 `cancelAnimationFrame`。
- **规则**：`js-batch-dom-css`

#### A-4 `ReasoningMessage` 展开时每片重跑整段 markdown + hljs

- **位置**：`web/src/components/agent/messages/ReasoningMessage.tsx:10-14`
- **问题**：`AssistantMessage` 用 `isLoading` 挡住了 O(n²) 重渲染，`reasoning` 没有该闸门，且 `msg.id` 在累加时不变；用户一展开就每片全文重渲染。
- **改法**：`useDeferredValue(msg.content)` 后再进 `useMemo`。彻底方案是给 reasoning 打 `isLoading`，建议单开票。
- **规则**：`rerender-use-deferred-value`

#### A-P2

| 位置 | 问题 | 改法 |
|---|---|---|
| `messages/AssistantMessage.tsx:51,61` | 为一个 click handler 订阅整个故障 Toast 上下文，`toasts` 一变所有 assistant 消息重渲染 | `FaultProvider` 拆成稳定的 `{push,dismiss}` 与易变的 `toasts` 两个 context |
| `agent/ChatInput.tsx:80-87` | 卸载清理里 `setAttachments` 是 no-op，只是借 updater 读最新值 | 用 `attachmentsRef` 存最新附件，卸载时直接读 ref revoke |
| `agent/ChatInput.tsx:54-57`、`lib/agentDraft.ts:9-16` | 每次按键同步写一次 sessionStorage | 打字路径节流 300 ms 落盘；prefill/submit 保持同步写（否则 `ChatInput.test.tsx:56` 会挂） |
| `agent/ChatInput.tsx:72-77`、`AgentComposer.tsx:26-31` | 自适应高度写 `auto` 后立刻读 `scrollHeight`，每次按键一次强制布局 | 收益不足以开票，登记即可；可选 rAF 内测量或 CSS `field-sizing: content` |

**两条反建议**（不要做）：

1. 不要把 `onEvent` 的 `setMessages` 包进 `startTransition`——`isLoading` 是序列状态，与 `finally` 的紧急 `clearLoading` 乱序会把回复劈成两段。
2. 不要给消息行加 `content-visibility: auto`——估算高度会破坏贴底判定。

---

### 3.2 管理端（Management 场景）

> 无 P0：路由全部 lazy、每页 ≤50 行、无 `state + useEffect` 维护派生值的反模式。问题集中在**组件边界切错**与**每次渲染重建的对象/数组**。

#### M-1 筛选草稿 state 与表格同组件 → 每敲一个字整表重渲染

- **位置**：`AdminDiagnosisPage.tsx:163-165` + `:907-960`；同构：`AdminUsersPage.tsx:106-109` + `:661-716`、`AdminNewsPage.tsx:127-130` + `:699-753`、`AdminKnowledgePage.tsx:114-119` + `:843-889`（✅ 已复核草稿 state）
- **问题**：草稿 state 和 `<DataTable>` 在同一个组件里，`onChange` 触发的 re-render 会连带重渲染整张表。诊断页每行 7 列 + 1 个 `RowMenu`（内部是 Base UI `Menu`），10 行即约 90 个组件实例 + 70 个 `column.render(row)` 闭包调用，每个按键一次。数据侧没有变化（请求只在回车时发），渲染侧却全额重算。
- **改法**：筛选面板抽成子组件（可共用一份 `<AdminFilterForm>`），草稿 state 下沉；父组件只接收「已应用查询」。
- **影响**：DOM 结构与类名完全一致，行为与测试不变，不触碰冻结基线。单次按键的组件渲染量从约 90 降到 0。
- **规则**：`rerender-memo`

#### M-2 `columns` 数组与 `onSortChange` 每次渲染新建，`DataTable` 里的 `useMemo` 永远失效

- **位置**：`web/src/components/admin/DataTable.tsx:129-138`；调用方 `AdminDiagnosisPage.tsx:567`/`:951`、`AdminUsersPage.tsx:381`/`:704`、`AdminNewsPage.tsx:402`/`:742`、`AdminKnowledgePage.tsx:436`、`AdminDashboardPage.tsx:138`（✅ 已复核 `useMemo` 依赖）
- **现状**：

```ts
const tableColumns = useMemo<ColumnDef<typeof features, T>[]>(
  () => columns.map((column) => ({ id: column.key, accessorFn: …, header: …, enableSorting: … })),
  [columns, onSortChange],   // ← 两个依赖每次渲染都是新引用
)
```

- **问题**：`columns` 是组件体里的数组字面量、`onSortChange` 是内联箭头，`useMemo` 等于没写。每次渲染重建 7 个 `ColumnDef` + 7 个 `accessorFn` 闭包，`useTable` 收到新 `columns` 后要重算列模型与 header groups。成本叠加在 M-1 的「每次按键」路径上；知识库页还叠加在 3 秒轮询上（`AdminKnowledgePage.tsx:181-182`）。
- **改法**：列定义提成模块级工厂函数 + `useMemo`，handler 转 `useCallback`（诊断/用户/资讯页目前是 `function` 声明，每次渲染新引用，需一并转）。
- **规则**：`rerender-memo`

#### M-3 新闻编辑页每次按键跑两遍 markdown + DOMPurify，且摘要在编辑模式根本不用

- **位置**：`web/src/pages/admin/AdminNewsEditPage.tsx:313`、`:319-325`、`:92-94`（✅ 已复核）
- **现状**：`contentLength` 与 `summaryText` 都依赖 `form.content`，而 `summaryText` 唯一消费点在 `tab === "preview"` 分支内。`renderNewsHtml` = `sanitizeNewsHtml(mdNews.render(content))`（`lib/markdown.ts:94-97`）。
- **实测**（子代理在本机 `web/` 依赖下跑）：markdown-it 渲染 4.3 ms @ 44k 字符、12.6 ms @ 132k 字符；DOMPurify 在 jsdom 下 64 ms @ 48k HTML 字符（jsdom 比真实浏览器慢约 3–5×，折算约 13–21 ms/次）。**一篇 4 万字资讯，每个按键约 30–45 ms 主线程占用**，超过一帧预算（16.7 ms），输入明显发涩。短文（<1 万字）约 3–5 ms 尚可。
- **改法**：摘要加 `tab !== "preview"` 早退；字数改用 `useDeferredValue(form.content)`。
- **影响**：`contentLength` 读数可能落后一帧，视觉不可见；需确认 `AdminNewsEditPage.test.tsx` 对字数的断言是否依赖同步更新。
- **规则**：`rerender-use-deferred-value`

#### M-P2

| 位置 | 问题 | 改法 |
|---|---|---|
| `DataTable.tsx:212,260-267` | `selectedKeys.includes()` 每行一次 + 全选 `every/some`，O(n) 查找落在每键重渲染路径上 | `useMemo` 建 `Set`；`selectableKeys` 用单循环合并 filter+map |
| `AdminNewsPage.tsx:416` → `lib/news.ts:31-41` | 缺 `summary` 的老数据每行每渲染对整篇正文跑 6 遍正则 | `newsPlainText` 加模块级 `Map` 缓存（带上界）；**仅缺 summary 时有收益** |
| `AdminDataAnalysisPage.tsx:175-204` | 同屏四个同构派生值，`distribution` 有 memo、另三个没有 | 三个都套 `useMemo(…,[stats])`；当前收益≈0，属防回归 |
| `AdminDiagnosisPage.tsx:155`、`AdminKnowledgePage.tsx:108`、`AdminNewsPage.tsx:119` | `initialReview` 只被 `useState` 消费一次，却每次渲染重读 `searchParams` | 移进 `useState(() => …)` 的 lazy initializer |
| `charts/TrendAreaChart.tsx:58`、`AdminNewsEditPage.tsx:93` | 渲染期新建正则字面量 | 提到模块级常量 |
| `styles/admin.css:919` 与 `:3862` | 同一选择器被同文件后文完全覆盖，`:919` 是死规则 | 删 `:919`（零视觉） |
| `styles/admin.css` 8 处 | 阴影硬编码绕过已有的 `--admin-shadow*` 令牌 | `[视觉·冻结阻塞]`，登记 Issue #84 |

---

### 3.3 公开 / 临床页与品牌层

#### P-1 `ScrollExpand` 每帧先写 `clip-path` 再读布局

- **位置**：`web/src/components/ScrollExpand.tsx:154`、`:166`、`:174-175`（✅ 已复核行号）
- **问题**：`applyProgress` 先写 `frame.style.clipPath`，紧接着读 `stage.getBoundingClientRect()`，rAF 每帧强制一次同步布局。这是落地页最高、元素最多的滚动区（sticky stage + 全幅媒体 + 三层叠加文字），低端机一次全量布局 5–15 ms，等于把 60 fps 预算吃掉一半。
- **改法**：把 `stage.getBoundingClientRect().top`、`media.clientWidth/Height`、`head.offsetHeight` 全部提到函数开头批量读，再统一写；`media` 尺寸缓进已有的 `measure()`（`:232-241`）。
- **影响**：同一组数值，只是读取顺序变了；零行为/视觉变化。该组件无单测。
- **规则**：`js-batch-dom-css`

#### P-2 `TargetCursor` 在 scroll 事件里做命中测试

- **位置**：`web/src/components/TargetCursor.tsx:194`（`elementFromPoint`）、`:209`（`getComputedStyle`）、`:422-431`（scroll 监听）（✅ 已复核行号）
- **问题**：`capture: true` 挂在 `window` 上，页面里任何可滚动容器的 scroll 都会进来；每个事件都走命中测试 + `getComputedStyle`，两者都是强制布局 API。`{ passive: true }` 只解决「不阻塞滚动」，解决不了处理器本身的布局读取。
- **改法**：scroll 里用 rAF 节流到每帧一次，cleanup 时 cancel；更彻底的做法是滚动时用已有 target 的 `getBoundingClientRect()` 重算位置，rect 离开指针才重新命中测试。
- **规则**：`js-batch-dom-css` / `client-passive-event-listeners`

#### P-3 `DiagnosisPage` 的 100 ms 计时器：整页重渲 + 每秒 10 次改动 `aria-live`

- **位置**：`web/src/pages/DiagnosisPage.tsx:130-136`、`:284-291`、`:488`（✅ 已复核计时器）
- **问题**：两个后果同源。① `setElapsed` 每 100 ms 触发整页（含 `ProductHeader` / `AccountMenu`）重渲染；② `elapsed` 还渲染在 `aria-live="polite"` 的日志 `<ol>` 内，读屏器在整个判读等待期持续播报。
- **改法**：耗时改用 ref 直写 DOM 的 `<span>`；日志里那格标 `aria-hidden`，live region 文本保持稳定。
- **影响**：一处改动同时修掉掉帧与读屏缺陷；视觉一致。
- **规则**：`rerender-use-ref-transient-values`

#### P-4 `ElectricBorder` 每次父渲染强制一次布局

- **位置**：`web/src/components/ElectricBorder.tsx:554-557`、`:798-801`（✅ 已复核无依赖 effect）
- **问题**：无依赖数组的 effect 每次渲染调 `wakeRef` → `resize()` 读 `offsetWidth/offsetHeight` 并无条件写 canvas 尺寸。`AgentComposer` 的受控 textarea 每敲一个字都触发。
- **改法**：`settings` 用 `useMemo` 固定、effect 依赖它；`resize()` 只留给 `ResizeObserver` 与挂载时。
- **影响**：边框参数仍即时生效，视觉无变化。
- **规则**：`js-batch-dom-css`

#### P-5 `index.html` 全路由预载两张光幕图

- **位置**：`web/index.html:8-10`（✅ 已复核）
- **现状**：`scroll-expand-light.webp` 190,074 B + `scroll-expand-dark.webp` 143,420 B，合计 333 kB，在**每个路由**以默认高优先级预载。
- **问题**：三条独立证据说明是纯浪费——① 只会用一张（`LandingPage.tsx:262` 按主题二选一）；② 不在首屏（包在 `Deferred` 里，`useInView` 命中才挂载，`LandingPage.tsx:40-41`）；③ 只在落地页（`ScrollExpand` 仅被 `LandingPage.tsx:26` 引用）。当前让 333 kB 与渲染阻塞 CSS（209 kB）和入口 JS（479 kB）抢带宽。
- **改法**：删掉两条 `as="image"` preload，改 `rel="prefetch"`，或交给 `<img src>` 自然触发。若要保留「切主题立刻换片」，在 `ScrollExpand` 进入视口后对另一主题发一次 `new Image().src`。
- **影响**：其他路由净省 333 kB；落地页 −143～190 kB。
- **规则**：`rendering-resource-hints`

#### P-P2

| 位置 | 问题 | 改法 |
|---|---|---|
| `NewsPage.tsx:110,221-223` + `lib/news.ts:31,58` | 受控搜索框每次输入把 9 篇正文重跑 4 遍正则 | 按 `rows` 一次性 `useMemo` 出 date/excerpt |
| `CardSwap.tsx:962-964` | layout effect 无依赖，每次渲染 `fit()` 读 `clientWidth` | effect 依赖 bounds 输入，尺寸判断交给 ResizeObserver |
| `TargetCursor.tsx:295-307` | 4 角 × width/height/borderWidth 每帧重写，共 16 次无效样式写入 | 常量移到 CSS 变量，帧内只写 transform 与圆角 |
| `Prism.tsx:521-530` | 指针事件最高 120 Hz，每事件一次 `getBoundingClientRect` | rect 缓存进已有 `resize()` |
| `HeroPrism.tsx:41-42`、`AgentComposer.tsx:59-60`、`ElectricBorder.tsx:504` | 品牌色三处硬编码，`#4f86e8` 不对应任何令牌 | 收进 `lib/brandPalette.ts`；归并取色 `[视觉·冻结阻塞]` |
| `NewsArticleView.tsx:118-129` + `news.css:592-604` | 封面无预留高度，加载后最多跳 520 px | 补固有宽高（零视觉）；改 `aspect-ratio` `[视觉·冻结阻塞]` |
| `TargetCursor.tsx:140`、`ScrollExpand.tsx:220`、`ElectricBorder.tsx:575`、`CardSwap.tsx:363` | 只在挂载读一次 reduced-motion，系统偏好中途变化不生效 | 改用已有的 `lib/useMediaQuery` |
| `App.tsx:8` | 入口 chunk 含落地页专属 `TargetCursor` | 在 `LandingPage` 内 lazy，放进已有 Suspense |

---

### 3.4 首屏与包体（实测）

| 指标 | 数值 |
|---|---|
| 入口 chunk | 479.08 kB raw / 156.54 kB gzip |
| 首屏 JS 合计 | ≈169.4 kB gzip（入口 + 5 个 modulepreload） |
| 首屏 CSS | 208.99 kB / 56.77 kB gzip（其中 89.6 kB 是 87 条 `@font-face`）；修复后 203.70 kB / 55.38 kB，`@font-face` 74 条 |
| 无条件预载图片 | 333 kB（**已移除**） |
| `@base-ui/react` | 150,882 B raw / **50,201 B gzip = 首屏 JS gzip 的 29.0%** |

> **已完成（2026-11-16）**：光幕图 `preload` 已删；字体从 `public/fonts` 迁到 `src/assets/fonts`
> （`dist` 13 MB → 8.5 MB，`dist/fonts` 的重复副本消失）；mono/serif 改用 latin 子集
> （字体文件 34 → 8，`@font-face` 87 → 74）。验证：`vite build` 产物对比、
> `vite preview` 下字体请求 200、`typecheck` / `lint` / 436 条测试全绿。

#### B-1 `@base-ui/react` 压进首屏关键路径

- **位置**：`App.tsx:8`（同步 import `LandingPage`）→ `LandingPage.tsx:20`（静态 import `ui/dialog`）、`:519`（使用）；`ProductHeader.tsx:4` → `AccountMenu.tsx:5` → `ui/menu.tsx:1`（✅ 已复核导入链）
- **问题**：两处都是**纯交互态**组件——首屏一个像素都不渲染它们，但 150 kB 代码必须在 LCP 之前下载并解析，还被写进 `index.html` 的 `modulepreload`。
- **改法**：`AccountMenu` 拆成轻量触发器 + `lazy()` 面板（匿名态直接渲染登录/注册 Link）；`LandingPage` 的示例记录弹层改成 `{open && <Suspense fallback={null}><Dialog/></Suspense>}`。**两处都改才生效**（只改一处 Menu 仍会把它拉回来）。
- **影响**：首屏 JS −50.2 kB gzip；菜单/弹层首次点击多一次 chunk 请求（<150 ms），有 Suspense 兜底。行为不变、视觉不变，但改变首屏装配方式，建议单独 PR 评审。
- **规则**：`bundle-conditional` / `bundle-dynamic-imports`

#### B-2 `/records` 与 `/profile` 把两个独立请求串成瀑布

- **位置**：`RecordsPage.tsx:78`、`ProfilePage.tsx:60`（✅ 已复核）
- **问题**：`loadMyStats`（`lib/records.ts:76`）打的是独立端点 `GET /diagnosis/stats/my`（`api.ts:346`），与列表请求无依赖；`records` / `total` 只在降级路径里用。但 `enabled: authed && data !== undefined` 把它挂在列表之后，两页都是「列表 RTT → 聚合 RTT」串行。
- **改法**：`enabled: authed`，queryFn 内 `catch(() => null)`，降级口径改到渲染期 `stats ?? summarizeRecords(...)`。
- **影响**：两页各 −1 个串行 RTT；需同步调整 `records.test.ts` 的降级用例。
- **规则**：`async-parallel`

#### B-P2

| 位置 | 问题 | 改法 |
|---|---|---|
| `src/fonts-subset.css:8-9` | `@import "../public/fonts/…"` 让 Vite 处理出 64 个 hash 文件进 `dist/assets`，`public/` 又原样复制 4.1 MB 到 `dist/fonts`（md5 相同） | 移到 `src/assets/fonts/` 并改相对路径，`dist` −4.1 MB |
| `src/main.tsx:5-8` | `ibm-plex-mono/{400,500,600}.css` 各含 5 个子集 × 2 格式 = 30 个字体文件 | 改 `latin-400/500/600.css` 与 `instrument-serif/latin-400.css`，字体文件 34 → 8 |
| `src/lib/api.ts:6` | `fetch-event-source` 2,353 B（约 1.0 kB gzip）在 modulepreload 里，仅 `/agent` 用 | 把 `streamChat` 拆出 `api.ts`，首屏 −2.7 kB gzip |
| `package.json` | `@fontsource-variable/geist` 全仓零引用；`shadcn`/`tailwindcss`/`@tailwindcss/vite`/`tw-animate-css` 是构建期工具却放 `dependencies` | 删 geist，其余移 `devDependencies` |
| `App.tsx:110` | 全仓 `componentDidCatch`/`getDerivedStateFromError` 零命中，render 抛错直接白屏 | 在 `<Suspense>` 内加路由级 class 边界，fallback 复用 `faultFromError` + `FaultNote` |
| `AdminNewsEditPage.tsx:24-27` | `@uiw/react-markdown-preview` 全家桶 994,620 B，单路由 369 kB gzip | 已在 lazy 边界内、非首屏；改用自有 `renderNewsHtml` 可减约 300 kB gzip，但会改交互，`[视觉·冻结阻塞]` |

---

## 4. 设计系统与 Tailwind 层

> 取证：17 个 CSS 文件 20,263 行；`@theme` / `@utility` / `@custom-variant` / `@layer` / `@apply` **全部 0 处**；全站真正用到的 Tailwind utility 只有 `sr-only`（7 次）。这套「令牌 + 手写 CSS」体系在正确性上比预期扎实——`tokens.contrast.test.ts` 有 40+ 条实跑断言，`.is-brand-page` 甚至有「不许碰临床语义色」的静态守卫。**无 P0。**

### 4.1 三个结构性风险

1. **同一语义两份事实源，靠特异性巧合维持**（`--paper-*` 最典型，且现有测试测令牌值、测不到上下文解析结果）。
2. **CSS 知道数据形状**（`:nth-child` 硬编码列序，列一重排窄屏卡片串位而测试全绿）。
3. **基础原语焊死逃生门**（行内 style → 基础层 `!important` → polish 文件跟进），规则与实现打架时输的永远是规则。

### 4.2 P1

#### D-1 Tailwind 的 `dark:` 跟系统偏好，不跟 `html.dark`

- **位置**：`web/src/index.css:1`；`components/theme-provider.tsx:186-190`；`index.html:22-35`（✅ 已复核：`dark:` utility 0 处使用）
- **问题**：v4 的 `dark:` 变体默认编译成 `@media (prefers-color-scheme: dark)`，而项目主题真源是手动挂的 `html.dark` class。今天 0 处使用，任何人写一次 `dark:bg-*` 就会在「系统浅色 + 手动暗色」用户上静默失效——这类 bug 只在特定组合下复现，评审很难看出来。
- **改法**：`index.css` 第 1 行后加 `@custom-variant dark (&:where(.dark, .dark *));`
- **影响**：3 行，零输出变化，纯防御。

#### D-2 令牌与 utility 层之间没有 `@theme` 桥

- **位置**：`web/src/index.css:1-12`、`web/src/styles/tokens.css:14-247`（✅ 已复核导入顺序）
- **问题**：两层代价。① `--brand-primary`、`--admin-primary`、`--risk-critical` 等令牌在 Tailwind 里不存在，写 `bg-brand-primary` 会静默失效（v4 不报错，只是不生成规则）。② `@import "tailwindcss"` 建立 `@layer theme, base, components, utilities`；后续 `@import "./styles/*.css"` 是**无层**的，无层规则优先于所有层——手写 CSS 永远压过 utility。今天因为只用 `sr-only` 没暴露，一旦混用就会得到「我的 utility 没生效」的困惑。
- **改法**：不是把 CSS 改成 utility，而是补一层**最小桥**。必须用 `@theme inline`——这些令牌随 `.is-admin` / `html.dark` 在上下文里换值，非 inline 的 `@theme` 会把值快照到 `:root`，utility 拿到的就是根级值，上下文覆盖全部失效。

```css
/* web/src/index.css —— 紧跟 @import "tailwindcss" 之后 */
@theme inline {
  --color-fg: var(--fg);
  --color-fg-2: var(--fg-2);
  --color-fg-3: var(--fg-3);
  --color-surface: var(--surface);
  --color-field: var(--field);
  --color-line: var(--line);
  --color-signal: var(--signal);
  --color-risk-normal: var(--risk-normal);
  --color-risk-attention: var(--risk-attention);
  --color-risk-critical: var(--risk-critical);
  --color-brand-primary: var(--brand-primary);
  --color-admin-primary: var(--admin-primary);
}
```

- **影响**：约 20 行，零视觉/行为变化（新增 `--color-*` 命名空间，与现有变量不重名）。

#### D-3 `--paper-*` 在暗主题被反转，与自身文档矛盾

- **位置**：`web/src/styles/tokens.css:21-34`、`:471-481`、`:594-611`（✅ 已复核）
- **问题**：文件开头把 `--paper-*` 定义成「不随主题翻转的纸面原语」，但 `html.dark` 把 `--paper-ink` 改成浅色 `#f0f1ed`，再靠 `--paper-*-dark` 第二套家族钉回；`.is-sheet` 的正确性只靠 `html.dark .is-sheet` 这一次特异性巧合兜住。`--on-dark-3`（`#8d948f`）与 `--paper-ink-3`（`#767d79`）是同角色两个值。
- **改法**：删掉暗色里的 `--paper-*` 反转与整个 `--paper-*-dark` 家族，`html.dark .is-sheet` 只留 `--surface`（已核对消费点仅 2 处）。
- **影响**：净减约 10 行，渲染逐像素不变。

#### D-4 列顺序被写进 CSS（`:nth-child`），与 TSX 列定义无绑定

- **位置**：`web/src/styles/admin-polish-ledger.css:567-660`、`admin-polish-cms.css`（共 28 处）
- **问题**：28 个位置块硬编码 `:nth-child(1..8)` 对应 `AdminDiagnosisPage` 的列序；列一重排，窄屏卡片整块串位，而 lint / typecheck / 单测全绿（两个文件自己都在注释里警告）。
- **改法**：`DataTable.tsx:240` 加 `data-col={column.key}`，CSS 改 `[data-col="result"]`。
- **影响**：1 行 + 28 处选择器机械替换，特异性相同，渲染不变。

#### D-5 `!important` 军备竞赛源于基础层

- **位置**：`web/src/components/admin/DataTable.tsx:325`（行内 `style={{ width: column.width }}`）→ `admin-redesign.css:1483-1489` → 两个 polish 文件 21 条 `!important`
- **问题**：行内 style 逼基础层用 `!important` 才能覆盖，`styles/README.md` 第 2 条「页面只叠加语境层，不重定义基础排版」因此无法遵守。
- **改法**：行内改传 `--col-w`，CSS `width: var(--col-w, auto)`；390 档只需 `--col-w: 96px`。
- **影响**：渲染不变，可删 12 条 `!important`；建议独立 PR。

### 4.3 现在就能做（零视觉 delta）

| 位置 | 问题 | 改法 |
|---|---|---|
| `package.json` | `class-variance-authority` / `cn` / `tw-animate-css` 全 0 引用（✅ 复核：`cn` 只有 `lib/utils.ts:1` 自我 re-export，无任何 importer） | 删依赖与空壳 `components.json`；`ui/` 两个 Base UI 薄壳保持 `className: string` |
| `app.css:47` | `::selection` 的 `var(--bg)` 根级未定义；`FaultToaster` 挂在 `App.tsx:118` 根部不在语境类内，`color` 整条失效（✅ 复核：`tokens.css:36-43` 兜底块确实漏了 `--bg`） | 兜底块补 `--bg: var(--field)` |
| `tokens.css:291-310,491` | `--danger` 未在 `.is-sheet` 钉回，暗色下纸上删除红约 1.7:1（当前不可达，消费全在 `agent.css`） | 补 `--paper-danger` / `--paper-danger-soft` 并在 `.is-sheet` 引用，加对比度断言 |
| `app.css:2718-2726` | reduced-motion 兜底缺 `animation-iteration-count: 1`，无限动画在 0.01 ms 下仍循环 | 补一行 |

### 4.4 与表格重构一起做

- `admin-polish-ledger.css:501-545` 与 `admin-polish-cms.css:817-851` 的 ≤900 px 卡片化块除作用域前缀外逐字相同 → 收敛成 `.admin-dt--cards`，页面只留各自的 grid-area 映射。
- `@media` 断点 → `@container`（当前仅 `admin-news-preview.css:150` 一处用容器查询；Drawer 装的是详情而非 DataTable，暂无「宽视口窄容器」场景，是机会不是缺陷）。
- `:hover` 门控分批：全站 177 条 `:hover`、0 条 `@media (hover: hover)`，触屏点按后 hover 粘住；先只门控带 `transform` / `box-shadow` 的。

### 4.5 其余 P2

| 位置 | 问题 | 改法 |
|---|---|---|
| `brand.css` / `auth.css` / `app.css` 等 9 文件 | 组件令牌散落，违反 `styles/README.md` 第 1 条；登录页并存 `--auth-fg-*`（13 用）与 `--aa-field-*`（3 用）两套命名 | 在 `tokens.css` 开组件令牌专属区块集中 |
| `app.css` / `brand.css` / `auth.css` / `admin.css` | 硬编码色 181 处，多数正当（mask `#000`、SVG `stop-color`、print、`color-mix` 的 `#fff/#000`）；真绕过是 `--auth-fg-*` / `--aa-field-*` / `--foot-accent` | 加白名单式静态护栏测试挡住新债，不做一次性清扫 |
| `app.css:1593,4104,4385`、`fault.css:236,355` 等 15 处 | 圆角游离令牌梯（22/18/11/9/7/5/3/2 px） | 升格成 `--radius-panel` / `--radius-note` 等令牌并引用替换，**数值不变**故零视觉 delta |

### 4.6 两条明确不建议

1. **不要改写成 Tailwind utility**：四场景 × 双主题靠上下文类切变量，utility 表达力不够；该补的是桥和护栏。
2. **不要引入完整 shadcn / CVA**：会把「Clinical 圆角 0 / Brand 圆角 24」压平。

### 4.7 最值得的一笔投资

给 `tokens.contrast.test.ts` 补「**上下文解析**」测试：jsdom 挂 `.is-sheet` / `.is-admin` / `html.dark`，读 `getComputedStyle` 算对比度。现有 40+ 条断言只测令牌值，测不到上下文解析结果——而「靠特异性巧合维持」的风险只有这种测试能抓住。

---

## 5. UI 冻结边界与建议切分

**UI 冻结**（tag `iris-ui-v2.1-freeze-20261115` → `80f53f7f`）**不覆盖性能、内存、a11y、构建层改动**，这些可以直接做。只有产生视觉 delta 的才需要登记 Issue #84。

| 类别 | 条目 |
|---|---|
| **冻结内（走 Issue #84）** | 8 处硬编码阴影换 `--admin-shadow*`（1–2 px 差异）、品牌色 `#4f86e8` 归并、资讯封面改 `aspect-ratio`、编辑页 `@uiw/react-markdown-preview` 瘦身（改交互） |
| **需单独拍板** | `@base-ui/react` 延迟加载不改变任何视觉，但改变首屏装配方式——建议单独开 perf PR 走评审，不并入其他改动 |
| **可直接做** | 其余全部：P0 修复、memo/回调、读写分离、并发请求、图片 preload、字体去重、ErrorBoundary、设计系统零 delta 项 |

### 建议三批

**批次 A · 零风险直改**
P0 的 `agentStream` 修复 + 设计系统零 delta 项（`@custom-variant`、`@theme inline`、`--paper-*` 清理、`data-col`、删死依赖、`--bg` / `--danger` 兜底）+ 构建层（字体去重、删图片 preload、加 ErrorBoundary）。

**批次 B · 性能重构**
Agent 的 memo / 回调 / 合帧、管理端筛选草稿下沉 + 引用稳定、`ScrollExpand` 读写分离、`DiagnosisPage` 计时器、records / profile 并发。

**批次 C · 冻结内**
Base UI 延迟、阴影令牌、品牌色归并、封面尺寸、编辑页瘦身，逐条登记 Issue。

---

## 6. 附录 A · 已核实无问题的部分

审查过的这些文件/模块**没有发现值得报告的问题**，列在此处以避免后人重复审查：

**Agent 子系统**：`agentStream` 的 SSE 生命周期（unmount abort、token 闸门、finally 收尾）无缺陷；`agentAttachments` / `agentImageOwnership` / `agentUpload` / `agentResources` 的职责切分清晰。

**管理端**：`AdminLayout.tsx:76-80` 用渲染期状态校正替代 effect（正确写法）；`AdminNav` / `AdminGate` / `Modal` / `Drawer` / `RowMenu` / `BatchBar` / `StatTile` / `MetricCell` / `ConfidenceCell` / `Toolbar` / `AdminEmpty` / `AdminPageHead` / `InsightEmpty` 均为纯展示、无 state/effect/内联组件；`ChunkInspector` 的 `PAGE = 30` 分批渲染正确；`KnowledgeWorkspace` / `DocumentReader` 的 effect 都带 `AbortController` + `cancelled` 标志并正确清理；五个图表组件全部 `isAnimationActive={false}`，`VIZ*` 常量在模块级；`lib/adminDomain` / `chartData` / `queryKeys` / `adminApi` / `queryClient` 无原地 sort、失效前缀与 key 结构一致；`useMediaQuery` 正是「订阅布尔值而非连续值」的推荐写法。

**公开/临床/品牌层**：登录/注册（`pending` 用 `useState` 正确）、`RecordSheet` / `RiskTag` / `ConfidenceDial` / `ClassScale`、`EmptyFrame` / `DisclaimerBar` / `FaultPanel` / `SectionHead` / `PageSkeleton` / `PlaceholderPage` / `SiteFooter` / `BrandPanel` / `BrandFooter` / `ProductHeader` / `Wordmark` / `navLinks` / `AuthShell` / `MobileNav` / `AccountMenu`；列表仅 10/9 条，不建议 `content-visibility`；无 `{count && …}` 式条件渲染；无内联组件；`ProfilePage` 的草稿对齐 effect 是必要例外；`Prism` / `ElectricBorder` 的 rAF、观察器、监听、上下文清理均成对，无泄漏。`AccountMenu` 的 `AccountAvatar` 是全站唯一正确写了 `width` / `height` / `decoding` 的图片，可作样板。

**设计系统**：双主题一致（暗色非反色、玻璃 alpha 取法不同、`--paper-surface` 恒白、FOUC 优先级正确）；对比度测试 40+ 条且用 `over()` 合成 rgba 再算；焦点可见性（30 条 `:focus-visible`，`outline: none` 仅 5 处均核对过）；44 px 触控门槛落实；`aria-live` / `sr-only` / `aria-sort` / `indeterminate` 用法正确；路由级 CSS 拆分（首屏 209 kB、管理端 87 kB 独立）；`color-mix()` 129 处用法领先多数 v4 项目；四个 polish 文件硬编码色计数为 0，令牌纪律在新增代码里是守住的。

**构建层**：`lucide-react` 静态命名导入、摇树后仅 6,165 B gzip；`recharts` 407.68 kB / `markdown` 216.39 kB / `lib` 308.10 kB 全部隔离在 lazy 路由；`mammoth` 确为动态 import（`documentPreview.ts:46`）；`/api` 同源无需 preconnect；`vite.config.ts` 不需要 manualChunks。

---

## 7. 附录 B · 复核状态与证据来源

**主会话逐条复核过的事实**：

- `agentStream.ts:98-117` 的引用突变（P0-1）
- `DataTable.tsx:129-138` 的 memo 失效（M-2）
- `AdminNewsEditPage.tsx:313/319-325` 的双跑（M-3）
- `index.html:9-10` 双图预载（P-5）
- `DiagnosisPage.tsx:130-136` 的 100 ms 计时器（P-3）
- `ElectricBorder.tsx:554-557` 的无依赖 effect（P-4）
- `LandingPage.tsx:20` + `ProductHeader.tsx:4` 的 Base UI 导入链（B-1）
- `fonts-subset.css:8-9` 与 `public/fonts` 的 4.1 MB 双份
- `tokens.css:471-481/594-611` 的 `--paper-*` 反转（D-3）
- 零 `ErrorBoundary`、零 `cva` / `geist` / `dark:` 使用、`sr-only` 7 次
- `index.css:1-12` 的导入顺序与无层 CSS（D-2）
- `RecordsPage.tsx:78` / `ProfilePage.tsx:60` 的串行 `enabled`（B-2）
- 各条引用的行号已用 grep 锚点核对（基线 `9d3c5317`）

**来自子代理、未逐条复核的**：其余条目均来自子代理的实读与实测（含一次真实 `vite build` 与一次 per-package 体积构建）。其中两条子代理自己标注了「当前收益≈0，属防回归」——`newsPlainText` 缓存、数据分析页三个 `useMemo`——按 P2 处理即可。

**度量口径**：包体数字来自 `vite 8.3.8` 真实构建（3.86 s）与 per-package 临时配置构建，产物均落在 gitignored 目录；`markdown-it` / `DOMPurify` 耗时来自本机 `web/` 依赖下的直接测量，jsdom 数字已按 3–5× 折算说明。

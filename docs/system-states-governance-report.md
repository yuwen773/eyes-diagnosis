# Iris System States 治理报告

> 工作树：`D:/Work/code/eye-diagnosis/.worktrees/system-states-react-bits`
> 分支：`fix/system-states-react-bits` @ `b9ff4e69`（含 `e65dad66`、`229c0352` 与 base 合并）
> PR：https://github.com/yuwen773/eyes-diagnosis/pull/97 （Draft，OPEN；远端 head 仍为旧的 `e65dad66`，本地新提交尚未推送）
> 日期：2026-11-17

## 1. Git 与开发基线

- Repository：`D:/Work/code/eye-diagnosis`（Java 线，master 主线之外的 R3 集成线）
- 初始 Base：`63116441`（`feat/r3-phase3-clinical`）
- 当前本地 base 跟踪：`183fc1a6`；`46628563`、`183fc1a6` 均为后端影像存储失败语义修复，已通过 `b9ff4e69` 合入本分支
- Branch：`fix/system-states-react-bits`
- 主检出工作树状态：有与本任务无关的后端 / 文档未提交改动，**未触碰**
- UI 冻结：`iris-ui-v2.1-freeze-20261115` 与已授权 #88–#90 均包含在基线中

**工作树例外说明**：通用协作约定倾向在当前工作树操作，但本任务原始指令明确要求“创建一个工作树、分支，用于 fix……必须进入该工作树进行开发”。因此创建了 `.worktrees/system-states-react-bits`，并在其中完成全部改动；后续“在 PR #97 原有分支继续、不新开第二个 PR 或工作树”也按此分支执行。这是有记录的例外，不是另起炉灶。

**冻结 UI 范围说明**：本分支不改冻结管理端的页面布局或组件结构。但 `fault.css` 是全站故障状态的共享皮肤，管理端多页（Dashboard / 数据分析 / 诊断管理 / 知识库 / 资讯编辑 / 资讯列表 / 用户管理）也渲染 `FaultNote`。独立评审指出共享 restyle 会把冻结管理端的状态外观一起改掉，判为 P1；本轮已用 `.is-admin` 稳定祖先选择器在 `fault.css` 末尾恢复冻结基线的 `FaultNote` / `FaultPanel` 视觉声明，只让非管理端页面使用新的 Iris 状态皮肤。未改 `AdminGate.tsx` 本体的 loading / denied 状态。

## 2. 变更摘要

### 新增 / 修改组件与样式

| 文件 | 变化 |
|---|---|
| `web/src/components/system/IrisStates.tsx` | 新增 `IrisOptic` / `IrisPageLoading` / `IrisRetryAction` / `IrisErrorState` / `IrisEmptyState` / `NotFoundPage` |
| `web/src/styles/system-states.css` | 新增全部状态视觉，令牌驱动，零新增硬编码色；reduced-motion 实质停用动画 |
| `web/src/components/RouteErrorBoundary.tsx` | fallback 改走 `IrisErrorState`；文案改事实陈述，删除不存在的「已记录」；保留 resetKey、极小边界与 console 现场 |
| `web/src/components/FaultPanel.tsx` | 保持对外 props 不变，内部委托 `IrisErrorState`；HTTP code 推导严重度与故障种类，保留状态码 / 端点读数 |
| `web/src/components/PageSkeleton.tsx` | 保持导出与 `role=status` 语义，视觉改为 `IrisPageLoading` |
| `web/src/pages/AgentPage.tsx` | 会话探测加载态由裸文字改为 `IrisPageLoading`；保留 ProductHeader 外壳 |
| `web/src/App.tsx` | 未知路由由静默重定向改为真正的 404 页面 |
| `web/src/index.css` | 引入 `system-states.css` |
| `web/src/styles/fault.css` | 仍在生产的 `FaultNote` / `FaultToaster` 皮肤统一：去掉细红竖线、9.5px 等宽仪表标签、方块指示灯；语义色只进入小圆点与描边；文字用 `--fg`/`--fg-2`；按钮触控目标 ≥44px；保留全部 class / DOM / 生命周期 |
| `web/e2e/system-states.spec.ts` | 新增 3 条无账号 E2E：404 + replace、502 + 一次明确重试、渲染错误兜底 |
| `docs/system-states/evidence/**` | 归档 before/after/compare 共 44 张 PNG + 取证说明 |
| 对应测试 | `IrisStates.test.tsx`、`RouteErrorBoundary.test.tsx`、`system-states.contrast.test.ts`；`fault.test.tsx`、`hardcoded-colors.test.ts` 继续通过 |

### React Bits 实际采用情况

**未引入任何 React Bits 组件，未新增任何依赖。**

React Bits 官方仓库当前许可为 **MIT + Commons Clause v1.0**；Commons Clause 禁止销售、再许可和再分发组件本身（单独、打包或移植版）。本仓库公开，搬运上游组件源码会落在“移植版再分发”上。沿用仓库 2026-11-17 复核结论（`docs/design/iris-r3-user-experience-inventory.md` §6）。

| 组件 | 决定 | 替代实现 |
|---|---|---|
| Fade Content | 不引入 | 既有 `.reveal → .is-in` + 一次性 `@keyframes iris-state-in` |
| Blur Text | 不引入 | 品牌文字短过渡，无 `motion` 依赖 |
| Shiny Text | 不引入 | 加载文案用纯文字，不额外高光 |
| Orb | 仅参考 | 纯 CSS conic-gradient 光学环，无 WebGL / canvas / 远程图片 |
| Glass Surface / Aurora / Spotlight Card | 不引入 | 复用 `--brand-glass-*` 令牌与既有 Optic Glass |

ErrorBoundary fallback 只依赖 React + CSS + lucide 静态图标；没有动态导入、WebGL、远程图片或复杂动画初始化。

## 3. 状态覆盖与视觉验收

### 覆盖检查

| 状态入口 | 结论 |
|---|---|
| `IrisBootStatus` | 不存在于 `web/src`；无需覆盖，登记为事实 |
| 全局 Loading | `Suspense` → `PageSkeleton` → `IrisPageLoading`；Agent 会话探测页内 loading 同走组件 |
| 全局 Error | `RouteErrorBoundary` → `IrisErrorState`；`FaultPanel` → `IrisErrorState`；`FaultNote`/`FaultToaster` 已换皮但保留语义与生命周期 |
| Empty State | 提供 `IrisEmptyState`；业务页已有自己的空态文案，本轮不批量替换，避免扩大范围 |
| 404 | `NotFoundPage` 共享 ProductHeader，单 `replace` 回首页出口 |
| `AdminGate` | loading = “VERIFYING…” 读数，denied / unavailable 页仍属冻结管理端范围；**未改**，单独登记 |

### 真实浏览器证据

- 归档真源：`docs/system-states/evidence/{before,after,compare}/`，不再依赖 `D:/tmp`。
- `before/` 9 张：从 `e65dad66^` 导出 web 源码、临时起 Vite，真实浏览器截取；`after/` 24 张：当前分支真实页面截取；`compare/` 11 张并排对照。
- 主题：通过 `localStorage.theme` 注入，每张截图前断言 `html.dark`；Light/Dark 均覆盖。
- 视口：桌面 1440×900；移动 375×812；响应式矩阵 390 / 768 / 1024 / 1440 / 1920。
- 网络错误：Playwright `page.route` 返回 HTTP 502；渲染错误：拦截 lazy chunk 注入抛错模块。均为浏览器内真实渲染，不是静态 mock 截图。
- 独立目视复核：
  - `compare/network-error-light-desktop.png`：旧细红竖线 + 等宽 FAULT 标签 + 远端重试，变为居中卡片、文字严重度标签、状态读数与近距主行动；按钮、标题、元数据完整。
  - `compare/fault-panel-restyled-dark-1440.png`：右图完整错误卡可见，严重度同时由文字与红点表达，无裁切；暗色主题对比充分。
  - `compare/404-light-mobile.png`：375px 下共享顶栏保留，404 主视觉与「回到首页」按钮完整，无横向溢出。
- reduced-motion：浏览器 `getComputedStyle(.iris-state-enter).animationName === "none"`，动画实质停止。
- 严重度标签对比度：早期 3.69–4.16:1 已修为 `--fg` 文字 + `--surface-2` 衬底；新增 `system-states.contrast.test.ts` 门禁锁定，浏览器实测浅/深上下文 11.04–15.41:1。
- 取证边界：`after/` 中 20 张与旧临时目录文件字节一致；`fault-panel-restyled-*` 4 张是稳定 502 后直接截取，已在 evidence README 说明；`compare/` 只做并排排版与必要的等比缩放，不伪造 before。

## 4. 工程验收（本地实测）

| 项目 | 结果 | 证据 |
|---|---|---|
| Typecheck | PASS | `npm run typecheck`，退出码 0 |
| ESLint | PASS | `npm run lint`，退出码 0 |
| Unit / Integration | PASS | `vitest run`：67 files / **608 tests** 全通过（base 合并后；合并前 606） |
| Build | PASS | `npm run build`；仅有既存 `AdminNewsEditPage` 大 chunk 警告 |
| CI gate checks | PASS | `npm run check:e2e-fixme` 0/0；`npm run check:gate-tests` 3/3 |
| E2E（最终，base 合并后） | PASS | 临时账号安全注入 + 临时账号删除；**14 passed / 0 skipped**，见下方清单 |
| GitHub Actions | BLOCKED | 本机 GitHub TLS / `curl` / `git push` 握手失败；web-access CDP 未启用；WebFetch 能看到 PR 仍停在旧 head `e65dad66`，新提交未推送，无法确认新 CI |

### 7 条历史上因缺账号 skip 的 E2E

原报告中的 7 条 `smoke.spec.ts` 全部依赖 `E2E_USER` / `E2E_PASSWORD`。此前无凭据，按规范记为 skipped，不冒充 PASS；本轮用公开注册接口创建一次性账号，凭据只走环境变量，执行后从 **3307** 库删除，代码中无写入。base 合并后这些仍在最终 14 passed 中：

1. 登录后判读页的影像槽可见 — 真实登录 + 页面渲染；风险：误把空白页当判读页（已断言影像槽）。
2. 记录页空态与合成记录：点行进入独立报告页 — 合成夹具 + 真实登录；风险：分页/统计口径错（已固定夹具）。
3. 资讯页点合成条目，详情标题与正文可见 — 合成条目；风险：标题定位错（按链接文字而非历史类名）。
4. 期刊头条的封面本身就能点进文章 — 真实首页布局；风险：封面不可点导致路径断（已断言）。
5. 目录锚点不给历史加条目：浏览器返回直接离开文章 — 真实浏览器历史；风险：错误历史项（已断言）。
6. Agent 发送后显示本地 SSE 回复并结束加载 — 拦截可控 SSE；风险：把真实模型推理当验收（用例明确是本地 SSE 契约，不代表临床推理）。
7. 工具没有回执就结束的回合，执行过程显示「未确认」而不是「执行中」 — 同上，验证终态文案。

最终 14 条 = 上述 7 + 2 条 admin-columns 几何（无需账号）+ 3 条 system-states 新增 + base 合并新增 2 条真实后端读取（本人记录 / 已发布资讯）。全部 `ok`，无 skip、无 fixme、无 `test.only`。

## 5. 性能基线

- 新增 CSS：`system-states.css` 约 9KB（未压缩）；`fault.css` 仅改样式声明，无新依赖、无 canvas/WebGL。
- `hardcoded-colors.test.ts` 中 `fault.css` 基线为 1，实测为 0（未增加）。
- 状态组件在首屏主 chunk 内同步 `import`，无新 chunk；构建产物无新增分包，仅既存 `AdminNewsEditPage` 大 chunk 警告。
- 动画仅 `opacity` / `transform` 与 CSS conic-gradient 旋转；reduced-motion 下停止；`min-height` 兜底避免 CLS。
- 未编造 FPS 或性能分数。

## 6. 独立 Review 与收敛

| Reviewer | 初轮发现 | 整改 | 定向复审 |
|---|---|---|---|
| A · React 架构 | P2 状态码读数丢失；P3 `-1`/`null` 分支无测试、重复翻译；P3 边界单出口 | `FaultPanel` 改走 `faultFromError`、补状态读数；补四条分支测试；边界加 `<a href="/">` 次出口 | 三项 CLOSED；另修 `IrisOptic` 后台标签页首帧未暂停 |
| B · UI / 品牌 | P1 严重度标签对比度；P2 光学环未页面隐藏即停；P2 状态读数丢失；P2 404 无共享外壳 | 全部修复；新增对比度门禁 | 四项 CLOSED；P3 登记不阻塞 |
| C · 可靠性 / 安全 | P2 五位业务码误判 critical；P2 渲染错误死胡同；P3 404 返回按钮可离站 | `faultFromError` 统一分类；次出口；404 单 `replace` 链接 | 三项 CLOSED |
| D · QA / 无障碍 / 性能 | P1×2 对比度；P2 缺对比度门禁；P2 截图矩阵不足；P2 `aria-busy` | 对比度修复 + 门禁；补 390/768/1024/1920 × 双主题；判定不加 `aria-busy` | 四项 CLOSED |
| E · 证据 / 恢复（本轮） | P1 冻结管理端状态皮肤被 `fault.css` 改动；P2 报告过期；P3 取证说明精度 | P1 追加 `.is-admin` 视觉恢复块；P2 本报告更新；P3 在 evidence README 补全来源与缩放说明 | 三项 CLOSED；冻结管理端布局与状态外观均保持基线 |
| F · 架构 / 回归（本轮） | 见 reviewer 返回；独立检查 fault.css 行为保持与 E2E 契约 | — | 见 §6 后续条目 |

### 键盘走查记录（2026-11-17，Chromium 1234）

- 404：Tab 顺序为顶栏 Logo → 主导航 → 主题钮 → 登录 / 开始判读 → 正文「回到首页」；`Enter` 激活回首页，`replace` 不留错误地址。
- 错误面板：Tab 到「重试」，`Space` / `Enter` 均触发一次 `refetch`；焦点环为 `--brand-cyan` 2px + 2px offset。
- 路由加载：纯 `role=status`，无交互控件，不抢焦点。
- 渲染错误 fallback：Tab 顺序为「重新加载本页」→「回到首页」；双出口可见可激活。

## 7. 未解决风险

1. **P1 · 冻结管理端状态皮肤（已关闭）**：`fault.css` 共享给冻结管理端；已用 `.is-admin` 作用域恢复冻结基线的 `FaultNote` / `FaultPanel` 视觉声明，restyle 仅作用于非管理端页面。
2. **GitHub 远端门禁未完成**：本地新提交（fault restyle、E2E、证据、base 合并）尚未推送；PR #97 远端 head 仍是 `e65dad66`。GitHub Actions 新 CI 未运行，不可报告 PASS。
3. `IrisEmptyState` 当前无生产调用点，避免扩大冻结范围；新代码可选用。
4. `AdminGate` 的 loading / denied / unavailable 仍为旧管理端读数字样，本轮未改，登记后续 Issue。
5. NewsPage / NewsDetailPage 的 `fault` 派生没有 `data === undefined` 守卫：后台 refetch 失败且有缓存数据时可能用错误面板盖掉仍可读内容；两页不在本 diff 内，登记后续 Issue。
6. `fault-panel-restyled-*` 的 before 源是 `network-error-{theme}-desktop.png`，不是同名 before；已在 evidence README 标明，避免误读。
7. P3：`system-states.css` 随全局 CSS 进入首屏（约 2.7KB gzip）；整页错误状态从 `<h2>` 起标题（沿用既有层级）。

## 8. Gate A–F 判定

- **Gate A 功能正确性：PASS** — 404 / 错误 / 重试 / 渲染兜底 / 鉴权 / Agent SSE / 管理端几何 / 真实后端读取均实测；无业务回归。
- **Gate B 设计一致性：PASS** — 新状态系统双主题与多视口通过；冻结管理端状态外观已由 `.is-admin` 作用域恢复基线，P1 关闭。
- **Gate C 稳定与安全：PASS** — 边界兜底不依赖 WebGL / 动态导入；无自动重试；鉴权与 SSE 契约未改；无凭据泄漏；生命周期保留。
- **Gate D 工程质量：PASS（本地）/ BLOCKED（远端）** — 本地 608 单测 + 14 E2E + typecheck/lint/build/gates 全绿；但新提交未推送、GitHub Actions 未重跑，**远端门禁不可报 PASS**。
- **Gate E Review 收敛：PASS** — P0 / P1 = 0；P2 已处置，P3 逐项登记。
- **Gate F 独立验收 / PR 更新：BLOCKED** — 评审已完成但 P1 未裁定；PR #97 远端 head 未更新，PR body 仍写旧的 2 passed / 7 skipped；GitHub Actions 未复查。

**最终结论：BLOCKED / NOT READY**

阻断项不是“测试没跑”：本地 608 单测 + 14 E2E + typecheck / lint / build / gates 全绿，P0 / P1 已清零。唯一阻断是远端交付门禁——新提交未推送、PR #97 与 GitHub Actions 仍停在旧 head `e65dad66`，不能报告 READY FOR REVIEW。

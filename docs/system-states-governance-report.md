# Iris System States 治理报告

> 工作树：`D:/Work/code/eye-diagnosis/.worktrees/system-states-react-bits`
> 分支：`fix/system-states-react-bits` @ `63116441`
> 日期：2026-11-17

## 1. Git 与开发基线

- Repository：`D:/Work/code/eye-diagnosis`（Java 线，master 主线之外的 R3 集成线）
- Base / HEAD：`63116441`（`feat/r3-phase3-clinical` tip，干净提交）
- Branch：`fix/system-states-react-bits`（本任务新建，独立工作树）
- PR：尚未创建（等待审查收敛）
- 主检出工作树状态：有与本任务无关的后端 / 文档未提交改动，**未触碰**
- UI 冻结：`iris-ui-v2.1-freeze-20261115` 与已授权 #88–#90 均包含在基线中；本任务不改冻结页面的布局与配色，只治理系统状态组件

## 2. 变更摘要

### 修改组件

| 文件 | 变化 |
|---|---|
| `web/src/components/RouteErrorBoundary.tsx` | fallback 改走 `IrisErrorState`；文案改事实陈述，去掉不存在的「已记录」；保留 resetKey、极小边界与 console 现场 |
| `web/src/components/FaultPanel.tsx` | 保持对外 props 不变，内部委托 `IrisErrorState`；按 HTTP code 推导严重度与故障种类；删除仪器式面板 CSS 的消费 |
| `web/src/components/PageSkeleton.tsx` | 保持导出与 `role=status` 语义，视觉改为 `IrisPageLoading` |
| `web/src/pages/AgentPage.tsx` | 会话探测加载态由裸文字「载入中…」改为 `IrisPageLoading`；保留 ProductHeader 外壳与 Agent 布局 |
| `web/src/App.tsx` | 未知路由由静默重定向改成真正的 404 页面 |
| `web/src/index.css` | 引入 system-states.css |
| `web/src/components/RouteErrorBoundary.test.tsx` | 断言更新为新文案；**新增**两条负向断言（不谎称已记录、不泄露堆栈），没有放宽原有断言 |

### 新增组件

- `web/src/components/system/IrisStates.tsx`：`IrisOptic` / `IrisPageLoading` / `IrisRetryAction` / `IrisErrorState` / `IrisEmptyState` / `NotFoundPage`
- `web/src/styles/system-states.css`：全部状态视觉，令牌驱动，零新增硬编码色
- `web/src/components/system/IrisStates.test.tsx`：加载/错误/空/404/FaultPanel 共 7 组断言
- `docs/system-states-inventory.md`：System States Inventory

### React Bits 实际采用情况

**未引入任何 React Bits 组件，未新增任何依赖。**

理由（已核实，非历史记忆）：React Bits 官方仓库当前许可为 **MIT + Commons Clause v1.0**；Commons Clause 禁止销售、再许可和再分发组件本身（单独、打包或移植版）。本仓库是公开仓库，把上游组件源码搬进来会落在「移植版再分发」上。仓库已有 2026-11-17 复核结论（`docs/design/iris-r3-user-experience-inventory.md` §6），本任务沿用该口径。

| 组件 | 决定 | 替代实现 |
|---|---|---|
| Fade Content | 不引入 | 既有 `.reveal → .is-in` + 一次性 `@keyframes iris-state-in` |
| Blur Text | 不引入 | 品牌文字短过渡，无 `motion` 依赖 |
| Shiny Text | 不引入 | 加载文案用纯文字，不额外高光 |
| Orb | 仅参考 | 纯 CSS conic-gradient 光学环，无 WebGL / canvas / 远程图片 |
| Glass Surface / Aurora / Spotlight Card | 不引入 | 复用 `--brand-glass-*` 令牌与既有 Optic Glass |

关键可靠性约束满足：ErrorBoundary fallback 只依赖 React + CSS + lucide 静态图标；没有动态导入、WebGL、远程图片或复杂动画初始化。

## 3. 视觉验收（真实浏览器）

工具：Playwright + 本机 Chromium 1234，dev server `http://localhost:5199`（本工作树），API 用 `page.route` 真实拦截，**非静态 mock 截图**。

| 场景 | 截图路径 | 结果 |
|---|---|---|
| 404 · light · 1440 | `D:/tmp/ss-shots/404-light-desktop.png` | 通过：共享 ProductHeader + 钴蓝/青/紫渐变 404，一条 replace 回首页出口 |
| 404 · dark · 1440 | `D:/tmp/ss-shots/404-dark-desktop.png` | 通过：暗底品牌色提亮，顶栏完整，文字对比充分 |
| 404 · light/dark · 375 | `D:/tmp/ss-shots/404-light-mobile.png` / `404-dark-mobile.png` | 通过：无横向溢出，按钮换行正常 |
| 网络错误 · light/dark · 1440 | `D:/tmp/ss-shots/network-error-light-desktop.png` / `network-error-dark-desktop.png` | 通过：App Shell 保留，错误面板在内容区，状态读数（502）恢复，主行动唯一 |
| 网络错误 · light/dark · 375 | `D:/tmp/ss-shots/network-error-light-mobile.png` / `network-error-dark-mobile.png` | 通过：按钮 100% 宽、≥44px，长中文不溢出 |
| 全局渲染错误 · light · 1440 | `D:/tmp/ss-shots/render-error-light-desktop.png` | 通过：拦截真实 NewsPage 模块注入 render throw，边界显示 fallback（重载 + 回首页双出口），无堆栈、无「已记录」 |
| 路由加载 · light · 1440 | `D:/tmp/ss-shots/route-loading-light-desktop.png` | 通过：延迟真实 lazy chunk 后显示 Iris 光学环 + 骨架条，无假进度 |
| 注意级错误 · light/dark · 390/768/1024/1920 | `D:/tmp/ss-matrix/fault-attention-{light,dark}-{390,768,1024,1920}.png` | 通过：HTTP 404 触发「请留意」标签，字号/边距/按钮在各宽度均无溢出 |

浏览器实测观察：
- `html.dark` 在 dark 场景确实生效（probe 输出 `html=dark`）；light/dark 两套截图视觉不同。
- reduced-motion：`getComputedStyle(.iris-state-enter).animationName === "none"`，动画实质停止而非降速。
- 渲染错误场景的 fallback 文本实测：`这个页面没能显示出来 / 需要处理 / 重新加载本页 / 回到首页`，没有 token、堆栈或内部诊断。
- 严重度标签对比度：早期版本在淡色衬底上只有 3.69–4.16:1（独立 Review 发现）。改用 `--fg` 文字 + `--surface-2` 衬底后，浏览器实测计算色为浅色 `rgb(20,23,26)`、暗色 `rgb(244,245,241)`；新增 `system-states.contrast.test.ts` 门禁锁定这条口径。

## 4. 工程验收

| 项目 | 结果 | 证据 |
|---|---|---|
| Typecheck | PASS | `npm run typecheck`（tsc -b）退出码 0 |
| ESLint | PASS | `npm run lint` 退出码 0 |
| Unit Tests | PASS | `vitest run`：67 files / 606 tests 全通过（含新增状态组件与对比度门禁） |
| Integration Tests | PASS | 同上（仓库的集成断言随 vitest 一同运行） |
| E2E | PARTIAL | `npm run test:e2e`：2 passed（admin-columns 几何）/ 7 skipped（需 `E2E_USER`/`E2E_PASSWORD`）；**未取得账号，不能报 PASS** |
| Build | PASS | `npm run build`；仅有既存的 `AdminNewsEditPage` 大 chunk 警告（与本次改动无关） |
| CI gate checks | PASS | `npm run check:e2e-fixme` OK；`npm run check:gate-tests` 3/3 pass |
| CI 工作流 | NOT RUN | 未推送分支，GitHub Actions 未触发；本地逐项复刻了 web job 的命令 |

## 5. 性能基线

- 新增 CSS：`system-states.css` 约 9KB（未压缩），无 JS 动画、无 canvas/WebGL、无新依赖。
- 新增组件全部在首屏主 chunk 内`import`（IrisStates 被 App 同步引用）；对 `index.js` 增量来自 6 个小函数组件 + lucide 三个静态图标，无第三方库。
- 构建产物与改动前相比未出现新 chunk；`AdminNewsEditPage` 1.09MB 大 chunk 是既存问题。
- 动画仅 `opacity` / `transform`（`iris-state-in`）与 CSS conic-gradient 旋转（`iris-optic`），reduced-motion 下停止，不产生布局位移（`min-height` 兜底 CLS）。
- 未编造 FPS 或性能分数。

## 6. 未解决风险与后续建议

1. E2E 四条真实后端冒烟因缺账号被 skip；合并前需要持账号者在联调环境重跑。
2. `FaultPanel` 的严重度由 `faultFromError` 统一推导；若后端以后返回非标准码，改在 `faultFromError` 一处处理，不在页面判断。
3. `IrisEmptyState` 本轮只提供组件，未批量替换各业务页已有的具体空态文案（避免扩大冻结范围）；新代码可选用。
4. `AdminGate` 的 loading / denied 页仍在冻结的管理端范围内，本轮未改其视觉；登记为后续 Issue。
5. NewsPage / NewsDetailPage 的 `fault` 派生没有 `data === undefined` 守卫：后台 refetch 失败且有缓存数据时会用错误面板盖掉仍可读的内容。两页不在本 diff 内，登记为后续 Issue（RecordsPage / RecordDetailPage 的口径可作参考）。
6. 以下为 P3 已知限制：`system-states.css` 随全局 CSS 进入首屏（约 2.7KB gzip）；`IrisEmptyState` 内使用光学环，但该组件当前无生产调用点；整页错误状态从 `<h2>` 起标题（沿用既有层级）。

## 7. 独立 Review 与收敛

| Reviewer | 初轮发现 | 整改 | 定向复审 |
|---|---|---|---|
| A · React 架构 | P2 状态码读数丢失；P3 `-1`/`null` 分支无测试、重复翻译；P3 边界单出口 | `FaultPanel` 改走 `faultFromError`、补状态读数；补四条分支测试；边界加 `<a href="/">` 次出口 | 三项 CLOSED；另提 P3 `IrisOptic` 后台标签页首帧未暂停 → 已改为 `useState(() => document.hidden)` |
| B · UI / 品牌 | P1 严重度标签对比度 3.69–4.16:1；P2 光学环未页面隐藏即停；P2 状态读数丢失；P2 404 无共享外壳 | 标签改 `--fg` + `--surface-2`；`visibilitychange` 暂停；恢复状态读数；404 加 ProductHeader | 四项 CLOSED；剩余 P3（离屏不停、info 色 latent）记录不阻塞 |
| C · 可靠性 / 安全 | P2 五位业务码误判 critical；P2 渲染错误死胡同；P3 404 返回按钮可离站 | `faultFromError` 统一分类；次出口；404 改单 `replace` 链接 | 三项 CLOSED；无新增问题 |
| D · QA / 无障碍 / 性能 | P1×2 对比度；P2 缺对比度门禁；P2 截图矩阵不足；P2 `aria-busy` 计划 | 对比度修复 + `system-states.contrast.test.ts`；补 390/768/1024/1920 × 双主题 attention 截图；判定不加 `aria-busy`（整块 status 整体挂载/卸载，加了反而抑制播报） | 四项 CLOSED；复核全部上下文对比度 11.04–15.41:1；剩余 P3 已登记 |

### 键盘走查记录（2026-11-17，Chromium 1234）

- 404：Tab 顺序为顶栏 Logo → 主导航 → 主题钮 → 登录 / 开始判读 → 正文「回到首页」；`Enter` 激活回首页，`replace` 不在历史里留下错误地址。
- 错误面板：Tab 到「重试」按钮，`Space` / `Enter` 均触发一次 `refetch`（React Query 拒绝并发重复）；焦点环为 `--brand-cyan` 2px + 2px offset。
- 路由加载：纯 `role=status`，无交互控件，不抢焦点。
- 渲染错误 fallback：Tab 顺序为「重新加载本页」→「回到首页」；两条出口均可见可激活。

## 8. Gate 判定

- Gate A 功能正确性：**PASS** — P0 场景全部实测可达；无新增业务回归。
- Gate B 设计一致性：**PASS** — 状态 UI 与 Iris 2.x 一致；双主题与 375/390/768/1024/1440/1920 覆盖；无旧式 ERROR 残留。
- Gate C 稳定与安全：**PASS** — 边界兜底不依赖 WebGL / 动态导入；无自动重试；鉴权与 SSE 契约未改。
- Gate D 工程质量：**PARTIAL** — typecheck / lint / 606 单测 / build / CI gate checks 本地全绿；E2E 2 passed / 7 skipped（缺账号），GitHub Actions 未推送触发。按规范「任一 Gate 不通过即 BLOCKED」，本 Gate 因 E2E 未完整执行不能报 PASS。
- Gate E Review 收敛：**PASS** — P0/P1 = 0；P2 全部关闭；P3 逐项登记于 §6。

**最终结论：BLOCKED / NOT READY**（唯一阻断为 E2E 四条真实后端冒烟缺账号未运行；其余工程与设计门禁通过，Review 已收敛）

# React 版管理后台移植设计（Spec）

> 日期：2026-11-08
> 状态：已与用户逐段确认（范围 / 视觉 / 图表 / 布局 / 守卫 / 逐页契约均已获批准）
> 范围：把 Vue 版管理员前端（`frontend/src/pages/admin/` + `AdminLayout` + `/news/edit/:id`）全量移植到 `web/` React 前端。
> 关联：前一次移植的设计先例见 `docs/superpowers/plans/2026-11-08-react-agent-page.md`（Agent 页）。

## 1. 已确认的决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 移植范围 | **全量对齐 6 页，mock 数据一并照搬**（仪表盘、数据分析两页 Vue 版是硬编码假数据，照搬并标注「示例数据」） |
| 2 | 视觉语言 | **跟随 `web/`「白色仪器」语言重写**——功能与信息结构一一对应，表格/图表/弹层按 `web/` 原语重画；不引 Ant Design Vue |
| 3 | 图表实现 | **手写 SVG，零图表库** |
| 4 | 区域框架 | **独立 admin 布局**——自带头部与侧栏，不出现主站 `SiteHeader` |
| 5 | 非管理员访问 | **无权限说明页**（自绘，说明只对管理员开放，给回首页出口） |
| 6 | 图表形式修正 | **撤掉饼图**，改排序横条（见 §5） |
| 7 | KPI 数字字体 | **等宽**（IBM Plex Mono）——按品牌走，不采纳 dataviz 的「大数字用比例字形」建议 |
| 8 | mock 病种名 | 统一换成模型八类（见 §8） |
| 9 | 后端 | **本次不动 Java 后端**；数据边界问题开票记录（见 §7） |

## 2. 路由与守卫

| 路由 | 页面 | 数据 |
|---|---|---|
| `/admin` | → 重定向 `/admin/dashboard` | — |
| `/admin/dashboard` | 仪表盘 | mock |
| `/admin/users` | 用户管理 | 真实 |
| `/admin/news` | 新闻管理 | 真实 |
| `/admin/diagnosis` | 诊断管理 | 真实 |
| `/admin/knowledge` | 知识库 | 真实 |
| `/admin/data-analysis` | 数据分析 | mock |
| `/admin/news/:id/edit` | 新闻编辑 | 真实 |

- 新闻编辑页收进 `/admin` 命名空间（Vue 版是 `/news/edit/:id`），已获用户确认。
- 守卫 `AdminGate` 三分支：
  - **未登录** → 复用全站 `AuthRedirect`（`web/src/App.tsx` 的 AUTH_EXPIRED_EVENT 机制），跳登录页并记住来路；admin API 调用产生的 40100 自动走这条链路，无需重复实现。
  - **已登录非 admin**（`user.userRole !== "admin"`）→ 自绘无权限说明页，说明该区域只对管理员开放，给回首页出口。
  - **admin** → 放行。
- 入口：主站 `AccountMenu` 增加「系统管理」一项，**仅对 admin 显示**。

## 3. 目录结构（`web/src/`）

```
pages/admin/
  AdminDashboardPage.tsx      # mock
  AdminUsersPage.tsx
  AdminNewsPage.tsx
  AdminDiagnosisPage.tsx
  AdminKnowledgePage.tsx
  AdminDataAnalysisPage.tsx   # mock
  AdminNewsEditPage.tsx
components/admin/
  AdminLayout.tsx             # 仪表梁 + 侧栏 + 内容区
  AdminGate.tsx               # 路由守卫（三分支）
  DataTable.tsx               # 语义化 <table>：mono 表头 / 发丝行线 / 分页 / 空-载-错三态
  Toolbar.tsx                 # 搜索/筛选/操作 一行工具条
  StatTile.tsx                # KPI 读数块
  Modal.tsx / Drawer.tsx      # 手写弹层（遮罩 + Esc + 焦点陷阱），复用 .scrim 词汇
  charts/
    TrendChart.tsx            # SVG 折线：2px 线 + 10% 面积淡填 + 十字准线 tooltip + 端点直标
    MiniTrend.tsx             # 迷你折线（小倍数单元格）
    MiniBars.tsx              # 迷你柱图（小倍数单元格）
    RankedBars.tsx            # 排序横条（疾病分布），ClassScale 同词汇
lib/
  adminApi.ts                 # 管理域 API 与类型（用户/新闻/诊断/知识库），错误统一 ApiError
styles/admin.css              # admin 区域样式，消费上下文令牌；在 index.css @import
```

## 4. 视觉系统

### 4.1 外壳

- **仪表梁**（顶部横条）+ **侧栏**共用恒定深墨 `--dark`（`#161a18`），两种主题下都不变——「管理后台是设备背面」。内容区吃上下文令牌，浅色=骨白纸面 / 暗色=暗房，与梁之间一根 `--dark-line` 发丝线断开。
- 仪表梁内容：← 返回主站 · 眼瞳 IRIS · 系统管理 / ADMINISTRATION ·（右侧）主题切换 + 账号名。梁上文字 `--on-dark / --on-dark-2`，橙色用反相档 `#ef7a45`。
- 侧栏：编号 01–06 + 中文页名；当前项 = 信号橙短竖线 + 加亮。窄屏（≤768px）折叠为横向标签条。
- 章节标题复用现成 `.sec-head` 原语（编号 + 中文 kicker + 发丝线 + 英文 mono 副标）；数字一律 `.num`（IBM Plex Mono）。
- AI 装饰零容忍（无粒子/扫描线/光环/渐变装饰），与全站一致。

### 4.2 图表基色（校验器实跑通过）

| 令牌 | 浅色 | 暗色 | 角色 |
|---|---|---|---|
| `--viz-accent` | `#d9541f` | `#d9591f` | 主系列（唯一彩色） |
| `--viz-mute` | `#8b9195` | `#767d79` | 去强调灰（上下文系列） |

- 校验记录：浅色对 CVD ΔE 13.5 (deutan) / 正常视觉 ΔE 19.1 / 对比度 ≥3:1，全 PASS；暗色对 CVD ΔE 11.0 (protan) / 正常视觉 ΔE 18.4 / 对比度 ≥3:1，全 PASS。
- 暗色档不用 `--signal` 的 `#ef7a45`（OKLCH L 0.704 超出标记色带 0.67 上限），`#d9591f` 是同色相带内档位。
- **橙色不用于状态标记**：`#d9541f` 与 critical 红 `#a83226` 正常视觉 ΔE 仅 12.7（暗色 4.5）。橙色只做结构性强调（当前导航项/主按钮/图表主系列）；状态一律 risk 三色 + 文字标签，绝不纯色圆点。
- 图表内表格读数、轴刻度、图例文字用文本令牌（`--fg/--fg-2/--fg-3`），**文字不穿数据色**。

### 4.3 图表规范（dataviz 硬性条款）

- 形式分配：
  - 近 7 天趋势（1 系列）→ `TrendChart`，无图例（标题即说明），端点直标。
  - 12 月 6 病种趋势 → **小倍数**（3×2 六块 `MiniTrend`）——6 系列超出双色词汇，身份由小标题承担。
  - 用户活跃 3 系列 → **小倍数**（3 块 `MiniBars`，每块 7 柱）。
  - 疾病分布（6 类 / 10 类）→ `RankedBars` 排序横条，单色橙 + 等宽数值 + 占比，**饼图撤掉**。
- 标记规格：柱 ≤24px、数据端 4px 圆角、基线端方角；线 2px round join；端点标记 ≥8px 带 2px surface ring；面积淡填 ~10%。
- 网格/轴：1px 实线发丝线（**禁止虚线**），一阶离面灰。
- 交互：折线十字准线 + 单 tooltip 列全系列；柱/横条以标记为命中目标（≥24px 命中区），悬停微亮。tooltip **不得是唯一读数通道**——每张图配「表」切换（mono 读数表）。键盘 focus 与 hover 同效。
- 筛选：一行工具栏放在被作用内容之上（DataAnalysis 的时间范围），不做每图独立筛选；刷新保持上一帧降不透明度，不闪骨架。

## 5. 逐页功能与后端契约

统一约定：
- 信封 `{code:0, data, msg}`；错误抛 `ApiError`（`web/src/lib/api.ts`）；40100=未登录、40101=无权限。
- **管理端一律走非缓存端点**（Vue 版三个列表页走 `/cache` 变体，Redis 缓存 5–10 分钟导致改完看不到；管理端要新鲜数据）。
- 雪花 id 一律 `string`（与 `web/src/lib/api.ts` NewsItem 先例一致）。
- 分页参数 `{current, pageSize}`，响应 `{records, total, size, current, pages}`。

### 5.1 用户管理（真实）

| 操作 | 端点 |
|---|---|
| 列表 | `POST /user/list/page/vo`（`userAccount`/`userName` 模糊检索） |
| 删除 | `POST /user/delete/{id}` |

- **删除守卫修正**：Vue 版写成「当前登录人是 admin 就不让删」（任何管理员都删不了任何用户）；React 版改为「**目标用户**是 admin 不给删」。
- 列：id（mono）、账号、用户名、头像、简介、角色（risk 风格标签：admin=attention 档文案「管理员」、user=normal 档「普通用户」、ban=critical 档「已封禁」，带文字标签）、创建时间、操作。

### 5.2 新闻管理（真实）

| 操作 | 端点 |
|---|---|
| 列表 | `POST /news/list/page/vo`（`title` 模糊检索） |
| 删除 | `POST /news/delete/{id}` |

- 列：id（mono，雪花字符串）、标题、摘要、作者、发布时间、操作（编辑 → `/admin/news/:id/edit`，删除需确认）。
- 新建入口 → `/admin/news/new/edit`（无 id 时为新建；后端 `saveOrUpdate` 同一端点）。

### 5.3 诊断管理（真实）

| 操作 | 端点 |
|---|---|
| 列表 | `POST /diagnosis/list/page/vo`（`result` 疾病名 like、时间过滤） |
| 详情 | `GET /diagnosis/get/{id}` |
| 人工复核 | `POST /diagnosis/update`（`DiagnosisResultDTO`：id + humanResult/humanSeverity/humanRecommendations/humanReviewNote） |
| 删除 | `POST /diagnosis/delete/{id}` |

- **字段修正**：`DiagnosisManageVO` 真实字段是 `username` / `createTime` / `reexamineStatus` / `url` / `result` / `confidence` / `severity` / `aiRejected` / `abstainReason` / `requiresReview`。Vue 版表格用的 `userName` / `diagnosisTime` / `humanReviewStatus` **在 VO 里不存在**（三列一直空白）。React 版按真实字段渲染。
- 复审状态呈现：`reexamineStatus`（1 未复审 / 2 复审中 / 3 已复审）为主；`requiresReview=true`（humanReviewStatus=AWAITING_REVIEW）标「待人工复核」（attention）；`aiRejected=true` 标「AI 拒识」（critical）+ `abstainReason` 摘要，此时 result/confidence/severity 后端已置空。
- 人工复核弹窗：humanResult 必填（后端强制，空则 40000「必须填写人工结论」）；**AI 字段一个不碰**（DTO 也只允许这四个 human* 字段）。
- 行点击/详情 → `Drawer` 展示 `GET /diagnosis/get/{id}` 全量 + 复核入口。
- 数据边界见 §7。

### 5.4 知识库（真实）

| 操作 | 端点 |
|---|---|
| 上传 | `POST /knowledge/upload`（multipart `files` 多文件 + `title`） |
| 列表 | `POST /knowledge/list/page`（`{current, pageSize}`） |
| 删除 | `DELETE /knowledge/delete`（body `{id}`） |

- 类型 `KnowledgeDocument`：`{id, userId, title, fileName, fileUrl, fileSize, fileType, chunkCount, status(0处理中/1已完成/2失败), createTime, updateTime}`。
- 保留 Vue 版行为：上传后进入「处理中」队列，`status===0` 时 3 秒轮询，全部完成自动停。
- 文件大小格式化（B/KB/MB）、状态标签（risk 三档 + 文字）。
- 数据边界见 §7。

### 5.5 新闻编辑（真实）

- 路由 `/admin/news/:id/edit`（`:id=new` 为新建）。
- 字段：`title` / `content`（Markdown）/ `coverImage` / `status`（0 草稿 / 1 已发布 / 2 下架）。
- 编辑器：**手写 textarea 编辑 + 预览切换**，预览复用 `lib/markdown.ts`（markdown-it + highlight.js，DOMPurify 已在其中）。**不引 md-editor-v3 的 React 对等物**，零新依赖。
- 封面上传：`POST /news/uploadCover`（multipart `file` + `newsUploadDTO.id`），JPG/PNG ≤5MB 前端预检（沿用 Vue 版规则）。
- 保存：`POST /news/edit`。**前端拦截**：正文短于 30 字时提示「正文至少 30 字（后端以正文前 30 字生成摘要）」并阻止提交——后端 `content.substring(0,30)` 对短文会 500。
- 文中图片上传端点 `POST /news/uploadAttachment` 本期**不搬**（Vue 版编辑页有入口；textarea 编辑器无插入钩子，列为后续增强）。

### 5.6 仪表盘 / 数据分析（mock）

- 数值照搬 Vue 版；病种名统一换为模型八类：正常 / AMD / 白内障 / 糖尿病视网膜病变 / 青光眼 / 高血压性视网膜病变 / 病理性近视 / 其他。
- **仪表盘**：KPI 条 4 块（诊断总次数 5,632 / 用户总数 1,284 / 今日新增 47 / 知识库文件 126，首块带趋势标 ↑12.5%）+ 近 7 天趋势 `TrendChart` + 疾病分布 `RankedBars`（6 类）+ 最近诊断记录表（5 条 mock，列：用户/结果/置信度/时间）。
- **数据分析**：KPI 4 块（总诊断数 8,452 / 确诊数 7,891 / 准确率 98.7% / 平均速度 2.3s，各带 trend）+ 12 月 6 病种小倍数折线 + 疾病分布 `RankedBars`（10 类）+ 按周活跃 3 系列小倍数柱图。时间范围筛选（30 天，mock 不真过滤）。
- 两页右上角常驻「示例数据 · SAMPLE」小标（mono，不做成装饰）。

## 6. 组件契约要点

- `DataTable`：`columns` + `data` + `loading/empty/error` + 分页受控；行内操作列用按钮（`.btn--sm`）；无 UI 库。
- `Modal`/`Drawer`：`open` 受控、Esc 关闭、遮罩点击关闭、焦点陷阱、关闭后焦点归还触发元素。
- `adminApi.ts` 每个函数对应 §5 表格一行；类型字段与 Java VO 逐一对名（camelCase 与 Java 实体一致——本项目列名即小驼峰）。
- 所有列表页错误呈现走 `describeError`（`lib/api.ts`）+ FaultToaster 语法。

## 7. 已知后端边界（开票，本次不动后端）

1. **诊断管理页列得出的是「当前管理员自己的」诊断**，不是全站——`DiagnosisController.listDiagnosisVOByPage` 强制 `setUserId(登录人)`，wrapper 无条件 `eq userId`。全站诊断复核需后端补管理员专用入口。
2. **知识库页列得出的是「当前管理员自己上传的」文档**——`KnowledgeBaseController.listPage` `eq userId`。
3. 两页底部各一行小字说明数据边界（如「列出的是你名下的判读记录」）；Java 线开票记录（建议标题：`admin 诊断/知识库列表缺全站视角`）。

## 8. 移植修正清单（相对 Vue 版）

| # | Vue 版问题 | React 版处理 |
|---|---|---|
| 1 | 诊断表格三列字段名对不上 VO，恒为空 | 按真实 VO 字段渲染 |
| 2 | 用户删除守卫写反（admin 删不了任何人） | 改为「目标是 admin 不给删」 |
| 3 | 列表走 `/cache` 端点，改完看不到 | 全部走非缓存端点 |
| 4 | 饼图 10 类（dataviz 违规） | 改 RankedBars |
| 5 | mock 病种名（近视/散光…）与模型八类不符 | 统一八类 |
| 6 | 正文 <30 字保存 500 | 前端拦截提示 |
| 7 | 封面上传 JPG/PNG ≤5MB | 前端预检保留 |

## 9. 测试与验收

- **vitest**（已有）只测纯逻辑：
  - 复审状态映射（reexamineStatus × requiresReview × aiRejected → 标签/风险档）；
  - 用户删除守卫（目标是 admin → 拦）；
  - RankedBars 占比计算与标签适配（标签放不下 → 移 tooltip/读数表）；
  - 摘要长度拦截（<30 字拦、≥30 放）。
- UI 组件不做组件测试（项目无先例），人工验收：
  - 浅色 + 暗色两主题各走一遍 6 页 + 编辑页；
  - 窄屏 ≤768px 侧栏折叠为横向标签；
  - Esc 关弹层、焦点归还；
  - 空态 / 加载态 / 错误态三态抽查；
  - AdminGate：匿名访问 admin API → 跳登录；普通用户 → 无权限页；admin → 放行；
  - 图表逐张对照 dataviz 反模式清单（无虚线网格、无逐点标数、无双轴、文字不穿数据色）；
  - 截图留档 `.shots/`。

## 10. 非目标（YAGNI）

- 不动 Java 后端（含管理员专用列表端点）。
- 不搬 Vue 版 MCP 设置面板（Agent 页移植时已定不搬，admin 无涉）。
- 不做批量用户操作、导入导出。
- 不做新闻文中图片上传（textarea 无插入钩子，列后续增强）。
- 不引 UI 组件库、图表库、富文本编辑器。

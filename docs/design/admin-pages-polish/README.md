# Iris 2.1 · R3.3 管理端六页视觉精修 —— 验收报告

| 项 | 值 |
|---|---|
| 源分支 | `feat/iris21-admin-pages-polish`（叠在 PR #79 的 `feat/iris21-admin-workspace` 之上） |
| 基线 commit | `8f83f542afcb2a95efc73a258734f9217b930f0d`（PR #79 HEAD，**未改写**） |
| 本轮 HEAD | `c90af659503d488a1f47d7c29d785aec6612c272` |
| 本轮 commit | `eac563a0`（首轮实现）+ `c90af659`（第一轮评审整改） |
| 改动范围 | 仅 `web/`（前端源码 + 证据脚本）与 `docs/design/admin-pages-polish/`（证据树）。后端、Flyway、Agent、鉴权、发布状态机**零改动** |
| 裁决 | **READY FOR HUMAN REVIEW**（机器门禁全绿；视觉终判仍以人工为准） |

---

## 1. 六页完成情况

| 页 | 完成情况 | 主要改动 | 视觉验收 |
|---|---|---|---|
| **数据中心** `AdminDataAnalysisPage` | 完成 | KPI 读数轨（窗口内判读 / 涉及结论类别 / 窗口内平均置信度 / 待人工复核·全站）逐格标注范围；重点卡列出**全部**复核状态档位并写明「AI 拒识并入『拒识 / 低置信 · 待复核』一档」；病种日趋势注明「只画判读量前 N 个类别（共 M 个）」；底部口径带按「窗口内 / 全站」分组；「表」视图读数表限高滚动、重点卡按内容收高 | `after/data-analysis-*.png`（8 张）+ `after/x-data-analysis-readtable-1440-*.png`；`after-nodata/data-analysis-*.png` 空窗口态；`compare/compare-data-analysis-*.png` |
| **诊断管理** `AdminDiagnosisPage` | 完成 | 判读结论列显示归一后的规范中文名 + 类别码 + 严重度；AI 拒识独立成「未出结论 + 拒识原因」，与「无判读结果」分开；疾病名筛选把规范名换算成库内落库标签，框下写明对照，空态说明检索口径；单元格 title 带库内原值；抽屉建议列表用自建计数器（序号不再恒为 0） | `after/diagnosis-*.png`（8 张）+ `after/x-diagnosis-{rowmenu,drawer,batch}-1440-*.png`；`compare/compare-diagnosis-*.png` |
| **新闻管理** `AdminNewsPage` | 完成 | 两级标题排版（标题 / 摘要分主次）；封面缩略图内联在标题格（有图才出现，不占列）；状态以 `RiskTag` 呈现并附状态口径脚注；行菜单里的下线类迁移（下架 / 转为草稿）先弹确认，发布与送审直接执行 | `after/news-*.png`（8 张）+ `after/x-news-{rowmenu,offline-confirm,batch}-1440-*.png`；`compare/compare-news-*.png` |
| **知识库** `AdminKnowledgePage` | 完成 | 「筛选与上传」合成一个面板；上传区说明可多选、可直接拖到该区域；台账拆出「文档 / 类型体积 / 分块数 / 处理状态 / 上传时间 / 操作」；文档预览抽屉里**原文与 RAG 切片分成两个独立区域**；类型段控件不再并列 MD 与 MARKDOWN 两种等价写法 | `after/knowledge-*.png`（8 张）+ `after/x-knowledge-{preview,rowmenu}-1440-*.png`；`compare/compare-knowledge-*.png` |
| **用户管理** `AdminUsersPage` | 完成 | 角色 / 身份两级 chip（管理紫 = 管理身份，`--risk-*` = 账号状态）；批量条（批量删除 / 封禁 / 解封）；新建用户弹层；台账列收紧 | `after/users-*.png`（8 张）+ `after/x-users-{create,rowmenu,batch}-1440-*.png`；`compare/compare-users-*.png` |
| **新闻编辑** `AdminNewsEditPage` | 完成 | 独立的编辑工作台（正文 / 发布设置双栏）；「编辑 / 预览」分段切换；预览**只渲染不落库**；保存状态读数（色点 + 文字）；≤640px 三条脚注全部保留（「字符」与「字」两套口径不再被藏起来） | `after/news-edit-*.png`（8 张）+ `after/x-newsedit-preview-1440-*.png`；`compare/compare-news-edit-*.png` |

**共享原语**：新增 `MetricCell`（KPI 读数格，仪表盘与数据分析共用）、`InsightEmpty`（空窗口解释面板）、读数表滚动壳 `.admin-viz__tablewrap`；`TrendAreaChart` / `RankedBars` / `SmallMultipleTrend` / `WeekBars` 只改读数与截断口径，不改图表语言。

---

## 2. 改动文件范围

**页面与组件（13）**
`web/src/pages/admin/AdminDataAnalysisPage.tsx`、`AdminDiagnosisPage.tsx`、`AdminNewsPage.tsx`、`AdminKnowledgePage.tsx`、`AdminUsersPage.tsx`、`AdminNewsEditPage.tsx`、`AdminDashboardPage.tsx`（仅共享组件抽取，**主布局未动**）、`web/src/components/admin/MetricCell.tsx`（新）、`InsightEmpty.tsx`（新）、`charts/ChartFrame.tsx`、`charts/RankedBars.tsx`、`charts/SmallMultipleTrend.tsx`、`charts/TrendAreaChart.tsx`、`charts/WeekBars.tsx`

**领域层（2）**：`web/src/lib/adminDomain.ts`、`web/src/lib/domain.ts`（新增 `classSearchLabel` / `classSearchHint`）

**样式（5）**：`admin.css`（共享）、`admin-polish-analysis.css`（新）、`admin-polish-ledger.css`（新）、`admin-polish-cms.css`（新）；`admin-redesign.css` 仅读取未改

**证据脚本（5）**：`web/scripts/evidence/admin-pages-polish.mjs`、`admin-pages-acceptance.mjs`、`compare.mjs`、`fixture-diagnosis.mjs`、`publish-handoff.mjs`

**未触碰**：后端 Java、Flyway 迁移、`web/src/lib/api.ts`、`web/e2e/`、`web/src/**/*.test.*`（`git diff 8f83f542..HEAD -- '**/*.test.*' '**/*.spec.*'` 为空）、`ui` / `master` 分支。

---

## 3. 测试与门禁

| 门禁 | 结果 | 计数 |
|---|---|---|
| `npx tsc -b` | PASS | 1/1 |
| `npx eslint .` | PASS | 1/1 |
| `npx vitest run` | PASS | 51 files / 424 tests 通过，0 失败，0 跳过 |
| `npm run build` | PASS | 1/1（已知警告：`AdminNewsEditPage` chunk 1,092 kB > 500 kB 提示线，本轮未处理） |
| `npx playwright test`（`web/e2e/smoke.spec.ts`） | 1 通过 / 3 失败 | **3 条失败为基线既有失败**，与本轮无关 |
| 验收探针 `admin-pages-acceptance.mjs` | PASS | **56 checks / 0 findings**（7 页 × 4 视口 × 双主题：无横向溢出、无 pageerror、无 console error、每页关键入口在位） |

**既有失败的证据**：`smoke.spec.ts` 断言的 `.chroma-card` 选择器在公开页 `NewsPage.tsx` 里已不存在（记录页 / 资讯详情 / Agent 回复三条）。曾把本轮改动 `git stash` 后在未改动的基线上复跑，**同样的 3 条失败**，随后 `git stash pop` 恢复全部改动。本轮**没有修改任何测试期望**去掩盖回归。

**数据卫生**：夹具（`fixture-diagnosis.mjs`）只写本机开发库 3306，标记 `modelVersion='fixture-iris21'`；采集完成后整段删除，复核残留 **0 行**（3306 / 3307 两库均为 0）。未向真实业务库插入、修改或删除业务数据；唯一的写操作演示是资讯「下架」确认弹层的**打开**（未点确认，库里状态未变）。

---

## 4. 截图证据

目录：`docs/design/admin-pages-polish/`

| 目录 | 内容 |
|---|---|
| `before/` | 改造前基线，6 页 × {390, 768, 1440, 1920} × 双主题（50 张） |
| `before-data/` | 改造前 + 窗口内有判读（数据分析页，10 张） |
| `after/` | 改造后 + 窗口内有判读：7 页 × 4 视口 × 双主题 + 22 张交互态（行菜单 / 详情抽屉 / 批量条 / 新建弹层 / 文档预览 / 预览模式 / 下架确认 / 图表读数表） |
| `after-nodata/` | 窗口内无判读（空数据态）：仪表盘与数据分析页，10 张 |
| `compare/` | 改造前 / 改造后并排对比，6 页 × {1440 light, 1440 dark, 390 light}（18 张） |
| `acceptance/` | `acceptance.json`：56 次探针的逐页结果（横向溢出量、console 错误、入口在位） |

**采集口径**：真实 React 页面（`web/`），本地后端 `:8081` + Vite `:5173`，管理员会话；浏览器为 Playwright Chromium（本机 1234 构建）。截图内所有数字来自本机 MySQL 3306 与后端聚合接口，**没有 mock、没有手工填充**。主题在建 context 时写 `localStorage.theme` 注入（取稳定态）。采集脚本见 `web/scripts/evidence/admin-pages-polish.mjs`（凭据只走 `CAP_USER` / `CAP_PASS`）。

**关于影像**：判读页缩略图引用的是仓库既有公开图地址（COS `public/` 路径），用户名为本机测试账号（`admin` / `钰玫` / `zhoucan` / `无名`），不含患者身份信息。

---

## 5. 独立评审与整改

**第 1 轮（两路独立评审，均为 REQUEST CHANGES）**

| 编号 | 来源 | 问题 | 状态 |
|---|---|---|---|
| P1-1 | 视觉 | 抽屉「建议」列表序号恒为 0（`counter(list-item)` 在 `display:grid` 的 `li` 上不自增） | **已修**：改用自建 `counter-reset/increment` |
| P1-2 | 视觉 | 分析页构成表口径标题类名不匹配（`.admin-analysis__breakdown-title` vs `.feature-card__breakdown-title`），按正文渲染 | **已修**：类名与样式对齐 |
| P1-3 | 视觉 | ≤900px 卡片化时 `.admin-dt__cell--pick{width:40px}` 未复位，勾选盒压住资讯标题首字 | **已修**：≤900 复位定宽与热区负边距 |
| P1-4 | 视觉 | 分析页 KPI 轨把「全站累计积压」与「窗口内」读数混排且无标注 | **已修**：标签写明范围（待人工复核 · 全站 / 窗口内平均置信度） |
| P1-5 | 视觉 | 底部口径带四项口径混排无标注 | **已修**：改为按「窗口内 / 全站」分组的一行口径带 |
| P1-6 | 功能 | **阻断**：诊断页疾病名筛选按规范名查不到任何行（后端按库内原值 LIKE） | **已修**：`classSearchLabel` 换算 + 框下对照提示 + 空态口径说明 + 单元格 title 带原值；后端未改 |
| P1-7 | 功能 | 资讯行菜单新增写操作无二次确认（下架不可逆） | **已修**：下架 / 转为草稿走确认 Modal；发布 / 送审直接执行；PR 描述已声明这是新增能力 |
| P2-1 | 视觉 | 分析页「表」视图重点卡出现约 200px 空紫洞 | **已修**：读数表限高滚动（`overflow` 在 `display:table` 上会被忽略，故加滚动壳）+ 重点卡按内容收高 |
| P2-2 | 视觉 | 四套分段控件并存（28px / 30px / 轨道式 / 4px 圆角） | **已修**：台账段控件统一 30px / 12.5px，编辑页 tab 与图卡切换同一副圆角 |
| P2-3 | 视觉 | 知识库类型段控件并列 MD 与 MARKDOWN | **已修**：长扩展名标成「MD（.markdown）」，短码统一显示 MD |
| P2-4 | 视觉 | 分析页「平均置信度」重复 2 次、「已复核」重复 3 次 | **已修**：重点卡去掉重复的「已复核」，口径带改分组小字 |
| P2-5 | 视觉 | 「AI 拒识 5」与构成档「拒识 / 低置信 · 待复核 15」易被合并理解 | **已修**：卡面写明拒识并入该档 |
| P2-6 | 视觉 / 功能 | `RankedBars.fitUnits` 量纲不成立（拿名字长度除像素预算），长名反被砍短 | **已修**：改成「轴宽 ÷ 字号」，`年龄相关性黄斑变性` 现在完整显示 |
| P2-7 | 功能 | 重点卡构成表只取前 4 档，与同页分布图对不上账 | **已修**：列全部档位 |
| P2-8 | 功能 | 病种日趋势只画前 6 类却未说明截断 | **已修**：卡头注明 |
| P2-9 | 功能 | 「涉及病种」把「正常」算成病种、口径不清 | **已修**：改名「涉及结论类别」+「只统计有结论的记录」 |
| P2-10 | 功能 | 验收探针不含仪表盘，而本轮改了它复用的图表原语 | **已修**：探针加入仪表盘（48 → 56 checks） |
| P2-11 | 功能 | `TrendAreaChart` 读数由「最新 N」改为「合计 N · 日均 X」，仪表盘复用后读数随之改变 | **已接受并披露**：见 PR 描述「共享原语改动」一节 |
| P3-1 | 视觉 | 行菜单截图与抽屉几乎相同（实际没拍到菜单） | **已修**：采集脚本改定位器（`aria-label^='更多'`），补拍行菜单 / 批量条 / 下架确认 |
| P3-2 | 视觉 | 资讯页截图与当时的代码不对应（并发改了封面列） | **已修**：封面改为标题格内联缩略图，截图重拍 |
| P3-3 | 功能 | 编辑页 ≤640px 隐藏第三条脚注 | **已修**：三条都显示，字号降一号 |
| P3-4 | 功能 | 夹具脚本入库会写本机 3306 | **已复核**：3306 / 3307 残留均为 0 行 |

**第 2 轮**：两路独立评审员（视觉 / 功能）在整改后的代码与重拍截图上复审；结论见本报告提交时的 PR 评论。

**未采纳的意见（附理由）**
- 「把 `--admin-maxw` 从 1920px 收窄到 1440px」：1920 下的空白来自列宽比例，不是版心宽度；1440 下标题列仍约 780px，收窄版心并不能解决，且会改动 PR #79 冻结的外壳宽度。**降级为 P2 记录，不做**。
- 「把资讯状态迁移整体挪回编辑页」：本轮新增行内迁移是有意为之的能力（已加二次确认），保留。

---

## 6. 剩余问题（已知）

| 级别 | 问题 | 影响 / 处置 |
|---|---|---|
| P2 | 1920px 下资讯 / 诊断台账的标题列仍有约 780px 空白 | 列宽比例问题，与版心无关；已在评审记录与 PR 中说明，本轮不改 |
| P2 | 分析页「病种分布」与「病种日趋势」的标题沿用 Dashboard 词汇（其中含「正常」类） | 仪表盘属冻结范围，两页保持同一词汇优先于单页改名；KPI 已改用「涉及结论类别」并在脚注写明只统计有结论的记录 |
| P3 | `AdminNewsEditPage` chunk 1,092 kB 超过 500 kB 提示线 | 构建仍成功；本轮不涉及分包策略 |
| P3 | `web/e2e/smoke.spec.ts` 3 条既有失败（`.chroma-card` 选择器失效） | 基线既有，**未修改测试期望**；建议另开一条任务修 e2e 选择器 |
| P3 | 「病种名 ↔ 库内标签」的换算只覆盖后端落库口径（中文短名） | 生产落库路径 `DiagnosisCategoryEnum.getChineseLabelByEnglishLabel` 恒为中文短名，映射完备；若将来落库允许英文标签，需同步补一条别名（前端一行映射） |

---

## 7. 本地集成条件

| 条件 | 状态 |
|---|---|
| 工作树干净、全部待集成源码在稳定提交内 | ✅ `c90af659`，`git status` 无未提交改动 |
| 机器门禁全绿 | ✅ 见 §3 |
| 验收报告完整、证据路径可查 | ✅ 本文件 + `docs/design/admin-pages-polish/` |
| 后端 / 数据库 / 迁移未改 | ✅ |
| 未合并进 `ui` / `master`、未部署 | ✅ 本分支只是叠在 PR #79 之上的 Draft PR |
| 视觉终判 | ⏳ **仍需人工复核**：截图与自动化通过 ≠ 视觉验收通过 |

**交接信号**：`D:\Work\code\iris-integration-handoff\ui-ready.json`（`ready=true`，原子写入：同目录临时文件 + `rename`）。若本分支在交接后再改动，先把 `ready` 置回 `false`，新提交通过验收后再重新发布。

---

## 8. 边界声明

- 截图与自动化通过 **不等于** 用户视觉验收通过；最终视觉结论以人工复核为准。
- 本轮未触碰后端接口、数据库结构、Agent 编排与 SSE、检索逻辑、医学诊断业务逻辑、登录鉴权、资讯发布状态机、知识库解析行为、新闻 Markdown 存取语义，也未改动 PR #79 冻结的仪表盘主布局。
- 界面上的每个数字都能追到后端端点与口径；无 mock、无手工填充、无假曲线。

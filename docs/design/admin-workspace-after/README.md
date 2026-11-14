# Iris 2.1 管理端工作台 · 证据

2026-11-14，分支 `feat/iris21-admin-workspace`（基线 `ui` @ `86332427`，即 PR #78 合并点）。

本轮只做**全局外壳 + Dashboard**；其余管理页只做外壳/响应式连带修正，未重新开发。

## 目录

| 路径 | 内容 |
|---|---|
| `../admin-workspace-before/` | 改造前基线（同一套夹具数据，1440 浅/深 + 390 + 1280 + 其余 6 页） |
| `with-data/` | 改造后，窗口内有判读（有数据态） |
| `no-data/` | 改造后，窗口内无判读（无数据态） |
| `fixture-iris21.sql` | 「有数据态」用的 DB 夹具 SQL（含标记字段 `modelVersion='fixture-iris21'`） |

`with-data/` 与 `no-data/` 各含同一组截图：

| 文件 | 内容 |
|---|---|
| `dashboard-1440-{light,dark}.png` | 仪表盘整页（1440） |
| `dashboard-1440-{light,dark}-viewport.png` | 仪表盘首屏（1440×900） |
| `shell-1440-{light,dark}.png` | 外壳近景：侧栏 + 工作区顶栏（900×520 裁切） |
| `dashboard-390-{light,dark}.png` | 仪表盘整页（390） |
| `nav-drawer-390-{light,dark}.png` | 窄屏导航抽屉 |
| `dashboard-1280.png` | 仪表盘整页（1280） |
| `page-{users,news,diagnosis,knowledge,data-analysis,news-edit}.png` | 其余管理页回归抽查（1440 浅色） |
| `w390-{diagnosis,news}.png` | 窄屏台账回归抽查（390 浅色） |

## 采集口径

- 真实 React 页面（`web/`），本地后端 `:8081` + Vite `:5173`，管理员会话。
- 浏览器：Playwright Chromium（本机 1234 构建，`E2E_CHROMIUM_PATH` 可覆盖）。
- 截图内所有数字来自本机 MySQL 3306 `diagnosis` 库与后端聚合接口，**没有手工填充**，
  没有 mock 接口，没有伪造趋势/百分比/增长率。
- 主题通过 `localStorage.theme` 在建 context 时注入（截图取稳定态，不拍过渡中间帧）。
- 采集脚本：`web/scripts/evidence/admin-workspace.mjs`（凭据只走 `CAP_USER` / `CAP_PASS` 环境变量）。

## 「有数据态」的数据来源（重要）

本机 3306 库在近 30 天窗口内**没有真实判读记录**（最新一条在 2026-04-30），
所以仪表盘默认渲染的是无数据分支。为了同时验证两种构图，向 `t_diagnosis`
插入 **12 行明确标记的夹具**：

- 每行 `modelVersion = 'fixture-iris21'`，可用该字段整段删除；
- 复用库里真实存在的 COS 图片 URL 与真实用户 id，不新建用户/文章；
- 覆盖 7 个病种、1 行 `aiRejected=1`（AI 拒识）、混合 `humanReviewStatus`
  （REVIEWED / AI_ONLY / AWAITING_REVIEW / PENDING_AI）、createTime 铺在 2026-10-20 ~ 2026-11-13；
- 采集完成后已执行 `DELETE FROM t_diagnosis WHERE modelVersion='fixture-iris21'`，库中已无残留。

`with-data/` 与 `no-data/` 因此是**同一套代码**在两种真实数据状态下的截图，
前后对照用 `../admin-workspace-before/`（与 `with-data/` 同一套夹具数据，改造前采集）。

## 边界

截图与自动化通过 **不等于** 用户视觉验收通过。最终视觉结论以人工复核为准。
本轮明确未做的部分见 PR 描述里的「本轮不做」一节。

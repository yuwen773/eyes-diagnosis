# Iris 2.1 管理端 · Visual Polish 证据

2026-11-15，分支 `feat/iris21-admin-workspace`（PR #79，基线 `ui` @ `86332427`）。

这一轮是**轻量级 Visual Polish**：外壳与 Dashboard 的材质、字号、密度、留白，
不重构页面骨架。**前后对照对象是 PR #79 第一轮的截图**（`../admin-workspace-after/`）。

## 目录

| 路径 | 内容 |
|---|---|
| `../admin-workspace-after/` | 第一轮（外壳 + Dashboard 重构图）的截图——**本轮的前对照** |
| `with-data/` | 本轮，窗口内有判读（有数据态） |
| `no-data/` | 本轮，窗口内无判读（无数据态） |

两组各含同一组截图：

| 文件 | 内容 |
|---|---|
| `dashboard-1440-{light,dark}.png` | 仪表盘整页（1440） |
| `dashboard-1440-{light,dark}-viewport.png` | 仪表盘首屏（1440×900） |
| `shell-1440-{light,dark}.png` | 外壳近景：侧栏 + 工作区顶栏（900×520 裁切） |
| `dashboard-390-{light,dark}.png` | 仪表盘整页（390） |
| `nav-drawer-390-{light,dark}.png` | 窄屏导航抽屉（含新增的显式关闭按钮） |
| `topbar-1440-{light,dark}.png` | 顶栏右侧近景：主题切换 + 账户菜单触发器 |
| `account-menu-1440-{light,dark}.png` | 展开的账号菜单（管理端变体：无重复的「系统管理」入口） |

> `topbar-*` 与 `account-menu-*` 与数据状态无关（顶栏不读统计），
> 两个目录里是同一组文件。

## 采集口径

- 真实 React 页面（`web/`），本地后端 `:8081` + Vite `:5173`，管理员会话。
- 浏览器：Playwright Chromium（本机 1234 构建）。
- 截图内所有数字来自本机 MySQL 3306 `diagnosis` 库与后端聚合接口，**没有手工填充**，
  没有 mock 接口，没有伪造趋势/百分比/增长率。
- 主题通过 `localStorage.theme` 在建 context 时注入（截图取稳定态）。
- 采集脚本：`web/scripts/evidence/admin-workspace.mjs`（凭据只走 `CAP_USER` / `CAP_PASS`）。
- 「有数据态」用 `../admin-workspace-after/fixture-iris21.sql` 的同一套夹具
  （12 行，`modelVersion='fixture-iris21'`）；**采集完成后已整段删除，库中残留 0 行**。

## 本轮改动与前后对照

| 位置 | 改动 | 对照文件 |
|---|---|---|
| 顶栏 | 账户身份由主站 `AccountMenu` 的**管理端变体**承载（头像 + 姓名 + 角色）；侧栏不再叠一张账户卡 | `topbar-1440-*.png`、`account-menu-1440-*.png` |
| 侧栏 | 导航项行高提到 40–44px；底部只留「返回主站」一个出口 | `shell-1440-*.png` |
| 窄屏抽屉 | 顶部新增显式**关闭按钮** | `nav-drawer-390-*.png` |
| 字号 | Dashboard 页头 32–36px，其余页头 26–30px，KPI 大数 32–36px，区块标题 15–17px；≤520px 回落 | `dashboard-1440-*.png` / `dashboard-390-*.png` |
| 卡片材质 | 管理端作用域圆角（控件 10px / 卡片 18px / 重点卡 20px）+ 柔和阴影 + 较轻发丝描边，浅/暗分别校准 | `dashboard-1440-*.png` |
| 画布 | 右上角一层极低对比（管理紫 7%）的**静态**氛围底；卡片仍是实心表面 | `dashboard-1440-*.png` |
| Dashboard 空窗口构图 | 积压卡与空窗解释一行、记录台账与运营待办一行，同一行等高；不再有半张卡高的空洞 | `no-data/dashboard-1440-*.png` |
| 零积压待复核卡 | 降为中性卡（不铺管理紫），动作退成安静的文字链接；卡面与同排等高，内部只留一道白 | `no-data/dashboard-1440-*.png` |

## 边界

截图与自动化通过 **不等于** 用户视觉验收通过。最终视觉结论以人工复核为准。
本轮明确未做的部分见 PR 描述里的「本轮不做」一节。

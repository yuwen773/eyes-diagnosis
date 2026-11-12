# R2.5-03 资讯编辑版 · 视觉证据

2026-11-13 摄于 R2.5 工作树（`localhost:5175`，真实后端代理），Chromium 1234 / SwiftShader。
列表与详情均为**真实接口数据**；只有「有封面」几组截图加了布局夹具，见文末。

## 文件

| 文件 | 说明 |
|---|---|
| `{light,dark}-news-1440-{fold,full}.jpg` | 列表首屏 / 整页 |
| `{light,dark}-news-lead-1440.jpg` | 头版（本机 13 条均无封面 → 文字头版） |
| `{light,dark}-news-rows-1440.jpg` | 发丝线双栏列表 |
| `{light,dark}-news-page2-1440.jpg` | 第 2 页（真实翻页，13 条 = 2 页） |
| `{light,dark}-news-search-1440.jpg` | 检索命中（「角膜」） |
| `{light,dark}-news-empty-1440.jpg` | 检索空结果 |
| `{light,dark}-news-cover-*.jpg` | 有封面路径：头版 / 列表（布局夹具） |
| `{light,dark}-detail-1440-{fold,full}.jpg` | 短文详情（45 字，无封面） |
| `{light,dark}-detail-cover-1440-fold.jpg` | 有封面详情（布局夹具） |
| `{light,dark}-news-{390,768,900,1920}-{fold,full}.jpg` | 四档宽度的列表 |
| `{light,dark}-detail-{390,768,900,1920}-fold.jpg` | 四档宽度的详情 |

## 实测

- 详情正文量宽 **564–585px**（15.5px 字号下约 68ch），390 下为 304px（受视口限制）。
- 390 / 768 / 900 / 1440 / 1920 均无横向滚动。
- 列表接口按 `publishTime desc`，头版取第一页第一条；「更新至」只在第 1 页且未检索时显示，
  翻页/检索后只报「共 N 条 · 第 X / Y 页」，不把结果集日期冒充站点更新时间。
- 两轮截图与 `typecheck` / `lint` / `vitest` / `vite build` 过程中 **0 console error**。

## 布局夹具说明

本机数据库 13 条资讯全部没有封面图。为验证「有封面」路径，截图脚本拦截真实的
列表/详情响应，仅给前两条追加 `coverImage: /fundus-demo.jpg`（仓库内已有的示例眼底图）。
**这不进入产品代码，也不改变任何数据口径**；无封面路径全部由真实数据覆盖。

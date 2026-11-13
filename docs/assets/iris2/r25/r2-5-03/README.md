# R2.5-03 资讯编辑版 · 视觉证据

2026-11-13 摄于 R2.5 工作树（`localhost:5175`，真实后端代理），Chromium 1234 / SwiftShader。
列表、翻页、检索、空结果与短文详情均为**真实接口数据**；「有封面」与「长文目录」
两条路径本机数据覆盖不到，用布局夹具补足，见文末。

## 文件

| 文件 | 说明 |
|---|---|
| `{light,dark}-news-1440-{fold,full}.jpg` | 列表首屏 / 整页 |
| `{light,dark}-news-lead-1440.jpg` | 头版（本机 13 条均无封面 → 文字头版） |
| `{light,dark}-news-rows-1440.jpg` | 发丝线双栏列表 |
| `{light,dark}-news-page2-1440.jpg` | 第 2 页（真实翻页，13 条 = 2 页） |
| `{light,dark}-news-search-1440.jpg` | 检索命中（「角膜」） |
| `{light,dark}-news-empty-1440.jpg` | 检索空结果（元信息只报条数与页码） |
| `{light,dark}-news-cover-*.jpg` | 有封面路径：头版 / 列表（布局夹具） |
| `{light,dark}-detail-1440-{fold,full}.jpg` | 短文详情（51–75 字，无封面） |
| `{light,dark}-detail-cover-1440-fold.jpg` | 有封面详情（布局夹具） |
| `{light,dark}-detail-long-1440-{fold,full}.jpg` | 长文详情 + 4 节目录（布局夹具） |
| `{light,dark}-detail-long-toc.jpg` | 点目录第一项的锚点落点 |
| `{light,dark}-detail-long-390-fold.jpg` | 390 下的长文与目录 |
| `{light,dark}-focus-{input,submit}.jpg` | 检索输入与实心按钮的键盘焦点环 |
| `{light,dark}-news-{390,768,900,1920}-{fold,full}.jpg` | 四档宽度的列表 |
| `{light,dark}-detail-{390,768,900,1920}-fold.jpg` | 四档宽度的详情 |
| `report.json` | 脚本实测输出（正文量宽、横向滚动、目录数、锚点落点、console error） |

## 实测

- 详情正文量宽 **564–585px**（15.5px 字号下约 68ch），390 下为 304px（受视口限制）。
- 390 / 768 / 900 / 1440 / 1920 均无横向滚动。
- 长文目录 4 节；点目录后标题落在视口 y=88（顶栏 64 + 24 的 scroll-margin，未被吸顶遮住）。
- 检索输入保留全局 1px currentColor 焦点环，并叠加钴蓝柔光；实心「检索」按钮的
  焦点环提高到 2px 正文色（白字色环在浅色画布上看不见）。
- 移动端翻页按钮实测高度 44px；目录项与返回入口在 ≤768 同样抬到 44px。
- 列表接口按 `publishTime desc`，头版取第一页第一条；「更新至」只在第 1 页、有数据且未检索时显示，
  翻页/检索后只报「共 N 条 · 第 X / Y 页」，空库不报更新时间。
- 两轮截图与 `typecheck` / `lint` / `vitest` / `vite build` 过程中 **0 console error**。

## 布局夹具说明

本机数据库 13 条资讯全部没有封面图、正文只有 51–75 字。为验证两条路径，截图脚本拦截
真实的列表/详情响应：

1. **有封面**：仅给前两条追加 `coverImage: /fundus-demo.jpg`（仓库内已有的示例眼底图）。
2. **长文目录**：把 `/news/13` 的详情响应替换成 4 节科普正文，用于验证 68ch 正文、目录
   sticky 与锚点落点。

两者**不进入产品代码，也不改变任何数据口径**；无封面与短文路径全部由真实数据覆盖。

## 复跑

```bash
# web/ 下先起 vite（:5175，/api 代理到 :8081）
node scripts/evidence/r25-03-news.mjs
```

可选环境变量：`EVIDENCE_BASE` / `EVIDENCE_OUT` / `EVIDENCE_CHROME`。
脚本会打印实测报告并以非零码退出如果捕获到 console error。

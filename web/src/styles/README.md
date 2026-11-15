# `web/src/styles/` · 文件归属

> 这一层只回答一个问题：**要改的样式该写进哪个文件**。
> 规则正文在仓库根 `DESIGN.md`，令牌真值是 `tokens.css`，`web/` 的速查是 `web/DESIGN.md`。

## 归属规则

1. **令牌只在 `tokens.css`**。颜色、间距、圆角、字体、阴影的增改都落在这里；页面文件只消费。
2. **共享原语集中**在 `admin.css`（管理端）与 `fault.css` / `markdown.css` / `shell.css`（全站）：
   `.admin-viz__*`（图表卡）、`.admin-dt__*`（台账）、`.admin-metric-*`、`.feature-card`、
   `.panel`、`.admin-batch`、`.fault-*`、`.markdown-body`、产品外壳。
   **页面文件只叠加语境层，不重定义基础排版**——否则深链直达某路由时会缺字重、缺表格样式。
3. **页面 / 批次样式写进对应的单页文件**（见下表）。新增页面先找既有文件，不新建第二套
   按钮、分段控件或卡片语言。
4. `admin-redesign.css` 是 C2 历史层，**不再往里加新规则**；新改动落到对应页面文件。

## 文件

| 文件 | 归属 |
|---|---|
| `tokens.css` | 设计令牌（唯一真源） |
| `tokens.contrast.test.ts` | 令牌对比度测试 |
| `app.css` | 全局基础（reset / 排版 / 画布） |
| `shell.css` | 公开路由共用的产品外壳（顶栏 / 页脚 / 移动抽屉） |
| `brand.css` | 品牌层，只在 `.iris2` 上下文生效 |
| `auth.css` | 登录 / 注册 |
| `news.css` | `/news`、资讯详情 |
| `records.css` | `/records`、`/profile` |
| `agent.css` | `/agent` |
| `disclaimer.css` | 免责条 |
| `fault.css` | 故障提示三尺度（toast / note / 区块） |
| `markdown.css` | `.markdown-body` 共用排版 |
| `admin.css` | 管理端外壳 + **共享原语**（`.admin-viz__*` / `.admin-dt__*` / `.admin-metric-*` / `.feature-card` / `.panel` / `.admin-batch`） |
| `admin-redesign.css` | C2 历史层（外壳 / 页头 / 指标轨）——只读，不再加新规则 |
| `admin-polish-analysis.css` | `/admin/data-analysis` |
| `admin-polish-ledger.css` | `/admin/diagnosis`、`/admin/users` |
| `admin-polish-cms.css` | `/admin/news`、`/admin/knowledge`、`/admin/news/edit` |
| `admin-document.css` | 知识库文档工作区（原文 / RAG 切片双栏） |
| `admin-news-preview.css` | 资讯编辑页的预览画布（复用公开详情页组件） |

## 改样式前

- 要新颜色 / 间距 / 圆角？先看 `tokens.css` 有没有现成令牌。
- 要新控件外观？先看根 `DESIGN.md` §4 的组件变体矩阵，别造第二套。
- 改完跑 `npm run typecheck && npm run lint`；动到令牌还会跑 `tokens.contrast.test.ts`。

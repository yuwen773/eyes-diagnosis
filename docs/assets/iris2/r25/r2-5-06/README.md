# R2.5-06 个人中心 / 判读记录 · 视觉证据

2026-11-13 摄于 R2.5 工作树（`localhost:5175`，真实后端代理），Chromium 1234 / SwiftShader。

## 文件

| 文件 | 说明 |
|---|---|
| `{light,dark}-profile-{390,768,1440,1920}-fold.jpg` | 个人中心：读数卡 + 头像卡 + 最近判读 + 资料表单 |
| `{light,dark}-profile-390-full.jpg` | 390 整页 |
| `{light,dark}-profile-focus-1440.jpg` | 昵称输入框的键盘焦点态 |
| `{light,dark}-profile-anon-1440.jpg` | 未登录态：只给登录入口（截图不含请求层证据，见下） |
| `{light,dark}-records-{390,768,1440,1920}-fold.jpg` | 判读台账：KPI 读数条 + 台账行 + 自有翻页控件 |
| `{light,dark}-records-390-full.jpg` | 390 整页 |
| `{light,dark}-records-expanded-1440.jpg` | 展开一条：真实记录纸 + 复诊申请按钮 |
| `{light,dark}-records-anon-1440.jpg` | 未登录态 |

## 实测

- 全部走真实后端与真实交互：读数卡口径、台账行、展开后的记录纸与复诊申请都是真数据；
  未登录态另起不带会话的上下文采集。
- 390 / 768 / 1440 / 1920 均无横向滚动（`scrollWidth === innerWidth`）；采集 **0 console error**。
- 台账数据来自本地开发库的临时账号（4 条判读，含 1 条 AI 拒识、1 条复审中），
  截图里的病名、置信度、模型版本、权重指纹都是数据库里的真实字段。
- **证据覆盖范围**：截图验证的是布局、读数与未登录态的**可见行为**；「未登录不发个人请求」
  由 `ProfilePage.tsx` 的 `enabled: authed && !!user` 查询门控与单测保证，不在本脚本的断言内。
- `typecheck` / `lint` / `vitest`（42 files / 325 passed）/ `vite build` 全绿
  （计数为审查整改后的基数，随 R2.5-05 合入从 302 增至 325）。

## 未覆盖态（明示缺口）

- 390 展开台账行、判读空态、复诊申请弹层三态没有单独截图（1440 已覆盖展开态，
  空态由 ProfilePage / RecordsPage 单测覆盖）；补拍时在复跑命令的账号上清空判读记录即可。

## 本轮改了什么（截图可对照）

- 个人中心按 `DESIGN.md` §1.5 从「四列 KPI 条」换成四张**读数卡**，并补上真实的
  **最近判读**列表（同页数据取前三条）与判读台账入口卡；标题降一档。
- 判读台账标题降一档；窄屏不再隐藏置信度与风险标签（挪到行内第二行）；
  行内分隔点挂在前一项后面，不再出现孤立的「·」。
- 翻页控件从 `.news__pager` 换成记录页自己的 `.records__pager`：此前借用的是
  路由级 `news.css` 的类，而该样式不在记录页加载，页码那行完全没有控件外观。
- 修掉 Tailwind v4 同名工具类 `.overline` 在字上方多画的一条线（全站可见，
  `web/DESIGN.md` 已知债务第一条）。

## 复跑

```bash
# web/ 下先起 vite（:5175，/api 代理到 :8081）
EVIDENCE_USER=<临时账号> EVIDENCE_PASS=<密码> node scripts/evidence/r25-06-profile-records.mjs
```

脚本会登录、逐页截图，写出 `report.json`（console error、横向滚动、台账条数），
并在有 console error 时以非零码退出。账号需要至少一条判读记录才能截到台账与记录纸；
账号请用一次性临时账号，采完删除；脚本不写任何凭据。

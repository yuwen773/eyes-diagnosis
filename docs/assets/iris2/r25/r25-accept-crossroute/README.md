# R2.5 全站验收 · 跨路由连续性 / 键盘 / 主题

2026-11-13 摄于 R2.5 工作树（`localhost:5175`，真实后端代理），Chromium 1234 / SwiftShader。
对应审计文档 `docs/design/iris-2-r2-5-product-shell-audit.md` §6.4 门禁 3/4/5/6 与 §6.5 跨路由连续性表。

## 文件

| 文件 | 说明 |
|---|---|
| `{light,dark}-{home,diagnosis,agent,news,profile,records}-{390,768,1440,1920}.jpg` | 按 `/ → /diagnosis → /agent → /news → /profile → /records` 顺序的真实路由跳转截图 |
| `theme-toggle-{390,1440}-after.jpg` | 主题切换后的当前路由（切换不丢路由） |
| `keyboard-focus-1440.jpg` | 顶栏连续 Tab 的焦点态 |
| `keyboard-drawer-390-open.jpg` | 移动抽屉打开：焦点在抽屉里、body 滚动锁定 |
| `keyboard-drawer-390-closed.jpg` | Esc 之后：抽屉关闭、滚动锁解除、焦点归还汉堡按钮 |
| `report.json` | 断言结果（errors / failures / 每档的实测读数） |

## 断言（全部通过才退 0）

- **导航结构**：每条路由顶栏都是同样三个目的地，短码 `01/02/03` 与可访问名称一致；
  `aria-current="page"` 至多出现一次。
- **品牌标记**：金属虹膜标在整条路线上尺寸一致（两版 SVG 都挂在 DOM 里，
  按 `html.dark` 切换，脚本取有尺寸的那一版）。
- **导航字体**：跨路由一致，不混入第二套字体。
- **横向滚动**：390 / 768 / 1440 / 1920 全程无横向滚动。
- **主题**：切换后 `html.dark` 翻转、路由不变、无 console error。
- **键盘**：Tab 停靠全部可见，且过半带可见焦点指示（outline 或 shadow）；
  移动抽屉打开即锁焦点与滚动，Esc 关闭后焦点归还汉堡按钮。

## 实测

- **0 console error**，**0 断言失败**。
- 采集走真实后端与真实登录会话（判读记录页读到的是数据库里的真实台账）。
- `typecheck` / `lint` / `vitest`（302 passed）/ `vite build` 全绿。

## 复跑

```bash
# web/ 下先起 vite（:5175，/api 代理到 :8081）
EVIDENCE_USER=<临时账号> EVIDENCE_PASS=<密码> node scripts/evidence/r25-accept-crossroute.mjs
```

脚本会登录、逐路由跳转、逐项断言，写出 `report.json`，
并在有 console error 或断言失败时以非零码退出。账号请用一次性临时账号，采完删除；
脚本不写任何凭据。

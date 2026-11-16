# Iris Optical Logo v1.0 接入候选 · 验证记录（2026-11-16）

**基线**：`ui` @ `b5f37e5c`（冻结 tag `iris-ui-v2.1-freeze-20261115` @ `80f53f7f` 的后续提交）。
本分支只做品牌资产替换与接入，**不解除冻结、不合并、不部署**。

## 改了什么

| 位置 | 变化 |
|---|---|
| `web/public/brand/` | 新增 light / dark 两色 64·96·192 位图，管理端单色 white / navy 64·96，favicon `.ico` + 180/192 磁贴 |
| `web/src/components/shell/Wordmark.tsx` | 金属虹膜 SVG → Optical Iris PNG，`srcSet` + `sizes="30px"` |
| `web/src/components/agent/WelcomeScreen.tsx` | 同上，56px |
| `web/src/components/admin/AdminNav.tsx` | 同心圆 SVG → 单色 Optical Iris；随主题翻转（浅色主题白、深色主题海军蓝） |
| `web/index.html` | favicon → `/brand/iris-favicon.ico`，新增 `apple-touch-icon` |
| `web/src/styles/app.css` | `.wordmark__zh` 由衬线改为 `--font-brand`（Manrope 700） |
| `web/public/iris-mark-metallic-*.svg`、`mark.svg` | 删除（历史版本见 git） |
| `DESIGN.md` / `web/DESIGN.md` | 品牌标口径与资产清单同步；「金属虹膜标」→「光学虹膜标」 |

未改页面布局、业务逻辑、后端接口或医学语义。

## 资产体积

| 资产 | 尺寸 | 体积 |
|---|---|---|
| `iris-optical-light-96.png` / `-192.png` | 96 / 192 | 10.8 KB / 30.4 KB |
| `iris-optical-dark-96.png` / `-192.png` | 96 / 192 | 10.8 KB / 30.8 KB |
| `iris-mono-white-96.png` / `iris-mono-navy-96.png` | 96 | 3.2 KB / 5.2 KB |
| `iris-favicon.ico` | 多尺寸 | 14.6 KB |
| 合计 `web/public/brand/` | — | **204 KB** |

1024 母版不进 `public/`，放在 `docs/design/assets/iris-optical-brand-v1.0/` 供追溯（含品牌包 README / QA / 接入建议）。
小尺寸由母版按 LANCZOS 生成，与品牌包自带 16–512 图标同一 alpha 轮廓。

## 验证

在 `web/` 下执行，全部通过：

```
npm run typecheck   # tsc -b，无输出
npm run lint        # eslint，无告警
npm run test        # 51 files / 434 tests passed
npm run build       # ✓ built（仅有既有的 chunk 体积提示）
```

真实浏览器（Chromium 1234，Playwright，dev server `:5174` → 后端 `:8081`）：

- `FONT: "Manrope Variable" 700, document.fonts.check → true`
- `FAVICON: 200 image/x-icon 14583 bytes`
- 页面无 console error / 无 4xx 请求

截图（Light / Dark 各一套，均为真实页面）：

| 文件 | 场景 |
|---|---|
| `landing-light.webp` / `landing-dark.webp` | 首页顶栏（1440×900） |
| `login-light.webp` / `login-dark.webp` | 登录页（认证壳） |
| `admin-light.webp` / `admin-dark.webp` | 管理端侧栏品牌位（管理紫） |
| `mobile-landing-light.webp` / `mobile-landing-dark.webp` | 移动端 390×844 |
| `mark-sizes-16-64.webp` | 16/24/32/48/64px 实际像素（白底/深底各一行） |

## 已知取舍

1. **16px 只能保留外环**：品牌包 README 已声明，星点细节在 16px 不可见；浏览器标签栏以真实环境为准。
2. **管理端用单色版**：品牌块底色本身就是管理紫，紫标压紫底会糊；沿用「紫色作容器、标用单色」的包内建议。品牌块底色随主题翻转，因此单色标也要两版（白 / 海军蓝）。
3. **字标从衬线改 Manrope**：DESIGN §1.6.1 一直写的是「Manrope 字标」，实现此前是 Instrument Serif；本次对齐规范，宽度略变，不影响布局。
4. 旧 `iris-mark-metallic-*.svg` 已删；如需回滚，`git revert` 本提交即可。

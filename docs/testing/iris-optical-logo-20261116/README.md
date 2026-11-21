# Iris Optical Logo v1.0 接入 · 验证记录（2026-11-16）

**基线**：`ui` @ `b5f37e5c`（冻结 tag `iris-ui-v2.1-freeze-20261115` @ `80f53f7f` 的后续提交）。
分两轮：`feat/iris-optical-brand-mark`（Logo 接入，PR #88 Draft）→
`fix/brand-canvas-fill`（画布/表面收口 + 静态审查整改）。
**不解除冻结、不合并、不部署。**

## 第一轮：Logo 接入（`6124b0f0`）

| 位置 | 变化 |
|---|---|
| `web/public/brand/` | 新增 light / dark 两色 64·96·192 位图，管理端单色 white / navy 64·96·192，favicon `.ico` + 180 磁贴 |
| `web/src/components/shell/Wordmark.tsx` | 金属虹膜 SVG → Optical Iris PNG，`srcSet` + `sizes="30px"` |
| `web/src/components/agent/WelcomeScreen.tsx` | 同上，56px |
| `web/src/components/admin/AdminNav.tsx` | 同心圆 SVG → 单色 Optical Iris；随主题翻转（浅色主题白、深色主题海军蓝） |
| `web/index.html` | favicon → `/brand/iris-favicon.ico`，新增 `apple-touch-icon` |
| `web/src/styles/app.css` | `.wordmark__zh` 由衬线改为 `--font-brand`（Manrope 700） |
| `web/public/iris-mark-metallic-*.svg`、`mark.svg` | 删除（历史版本见 git） |
| `DESIGN.md` / `web/DESIGN.md` | 品牌标口径与资产清单同步；「金属虹膜标」→「光学虹膜标」 |

## 第二轮：画布/表面收口 + 静态审查整改

### 2.1 品牌画布未铺满视口（既有缺陷，非 Logo 引入）

判读 / 个人中心 / 诊断记录 / 资讯详情在内容短于视口时，页面根容器在免责声明条处
结束，露出 body 的旧仪器风骨白（浅 `#f3f4f1` / 暗 `#0b0d0c`），与品牌画布
（`#f2f6fc` / `#0b1425`）形成横带。

修法（`tokens.css`）：`#root > .is-brand-page { min-height: 100vh; min-height: 100dvh }`。
选择器锚在 `#root` 上——`.is-brand-page` 还被落地页判读记录弹层与管理端新闻编辑的
设备预览复用，那两处是页内容器，不能被撑成一屏高。

### 2.2 旧仪器风表面令牌未收口

`.is-brand-page` 原先只接管 `--field / --bg / --line / --hr`，没接管 `--surface / --surface-2 / --surface-3`，
导致空态取景框等组件掉回旧冷绿灰（浅 `#e9ebe6` / 暗 `#242a27`）。现补：

```css
--surface:   var(--brand-surface);
--surface-2: color-mix(in srgb, var(--brand-surface) 92%, var(--brand-text));
--surface-3: color-mix(in srgb, var(--brand-surface) 84%, var(--brand-text));
```

用实底 + 少量品牌墨混出抬升面，不用半透明玻璃——内容表面（故障面板、输入框、
空态框、弹层）必须保证文字可读与遮挡一致。判读记录纸不受影响：`.sheet` 自带
`.is-sheet`，暗色下该作用域把 `--surface` 钉回纸面原语。

### 2.3 `theme-color` 跟随应用内主题

原先写死骨白 `#f3f4f1`，且只随系统 `prefers-color-scheme`。现改为：

- `index.html` 防闪烁内联脚本按实际解析结果写 `#f2f6fc` / `#0b1425`；
- `ThemeProvider.applyTheme` 每次切换同步改写 meta（用户手动切换也跟随）。

### 2.4 守卫页 CSS 加载缺口

`.admin-gate / .admin-denied` 的铺满与底色规则原先只写在 `admin.css`，
而 `admin.css` 由 `AdminLayout.tsx` 导入；守卫分支不渲染 `AdminLayout`，
规则从未加载。现移到全局 `app.css`，守卫页铺满一屏并使用管理紫画布。

### 2.5 死代码与过期注释

- 删除旧认证页 `.auth .btn / .auth--light .btn`（DOM 已无 `.auth` 类，规则从未生效，且含硬编码 `#f1f2ee / #14171a`）；`.auth__glass` 例外——被落地页收尾玻璃复用，保留。
- 删除 `admin.css` 中对 PNG 无效的 `color: var(--admin-on-primary)`。
- `tokens.css` / `app.css` 文件头「白色仪器」→ Iris 2.0 四场景口径。
- `agent.css`、`scripts/evidence/r25-accept-crossroute.mjs` 的「金属标」注释 → 光学标。
- 删除零引用资产 `web/public/brand/iris-app-tile-192.png`、`web/public/vite.svg`。

### 2.6 单色标从统一母版派生（设计决策 A）

原单色版是品牌包另画的近似图形（挖空中心，非零 alpha 411,775 px），与彩色版
轮廓不同。现改为从 `iris-optical-primary-1024.png` 派生：

- alpha 通道原样保留 → **与彩色版同一核心轮廓**（sha256 `d4f31d69…`，534,590 px）；
- 亮度按 p5–p95 归一化，映射单色明度阶梯（white `#7a7a7a→#ffffff`、navy `#08152b→#4a6ca0`）；
- 16px 下内部纹理压缩为可辨的「环 + 心」，管理端实际使用 24px。

品牌包原始单色母版保存在 `vendor-original/`，仅作来源追溯。

### 2.7 文档口径统一（设计决策 B）

- `docs/design/assets/iris-optical-brand-v1.0/INTEGRATION.md` 重写为**当前真实实现**
  （路径、尺寸、引用方式、单色派生规则）。
- `PACK-README.md` 加「历史资料 · 非有效接入说明」标记；被取代的两条口径就地标注。
- `DESIGN.md` §3.9：三色母版共享 alpha、项目内只用 light/dark、单色派生与尺寸口径。
- `IRIS_2_DESIGN_REFERENCE_BRIEF.md`：金属标 SVG 路径 → 光学标 + INTEGRATION 指针。
- `QA.json` 增加 `mono_derivation`（派生方法、sha 一致性、原始文件位置）。

## 资产体积

| 资产 | 尺寸 | 体积 |
|---|---|---|
| `iris-optical-light-96.png` / `-192.png` | 96 / 192 | 10.6 KB / 29.7 KB |
| `iris-optical-dark-96.png` / `-192.png` | 96 / 192 | 10.6 KB / 30.1 KB |
| `iris-mono-white-96.png` / `-192.png` | 96 / 192 | 7.0 KB / 16.3 KB |
| `iris-mono-navy-96.png` / `-192.png` | 96 / 192 | 8.4 KB / 21.5 KB |
| `iris-favicon.ico` | 多尺寸 | 14.2 KB |
| `iris-app-tile-180.png` | 180 | 25.8 KB |
| 合计 `web/public/brand/`（14 个文件） | — | **195.2 KiB / 199,854 B** |

1024 母版不进 `public/`，放在 `docs/design/assets/iris-optical-brand-v1.0/` 供追溯
（含品牌包 README / QA / 接入说明）。小尺寸由母版按 LANCZOS 生成。

## 验证

在 `web/` 下执行，全部通过：

```
npm run typecheck   # tsc -b，无输出
npm run lint        # eslint，无告警
npm run test        # 51 files / 434 tests passed
npm run build       # ✓ built（仅有既有的 chunk 体积提示）
```

真实浏览器（Chromium 1234，Playwright，dev server `:5175` → 后端 `:8081`）：

| 检查 | 结果 |
|---|---|
| `theme-color` 初始（system / light / dark） | `#f2f6fc` / `#f2f6fc` / `#0b1425` |
| `theme-color` 应用内切换 light↔dark | `#f2f6fc` ↔ `#0b1425`，与 `<html>` 类同步 |
| 判读页底部（2000×1025，Light/Dark） | 不再露底，根容器 `min-height` = 视口 |
| 空态取景框（`/records`） | 浅 `rgb(236,237,239)` / 暗 `rgb(40,55,77)`，品牌冷调 |
| 守卫页（普通用户访问 `/admin/*`） | 铺满 1000px，管理紫 `rgb(244,241,250)` / `rgb(18,16,28)` |
| 认证页按钮（`.auth-auth .btn`） | 浅 `rgb(36,87,201)` 白字 / 暗 `rgb(133,181,255)` 深字 |
| 管理端侧栏标 | 浅主题 mono-white 24px / 暗主题 mono-navy 24px，随主题翻转 |
| Agent 欢迎屏标 | 56px，Light/Dark 各挂一版，另一版 `display:none` |
| 判读记录弹层 | 浅 `#ffffff` / 暗 `#17263d`，内嵌记录纸仍为白纸 |
| 设备预览容器 | 1240×622（与修复前一致，未被 `min-height` 撑高） |
| 资产可达性 | 14 个文件全部 200；favicon `image/x-icon` 14,583 B |
| 旧 SVG 路径 / 失效引用静态扫描 | `iris-mark-metallic`、`mark.svg`、`public` 下的 `-1024` 路径：**零命中** |

截图（真实页面，Light / Dark 各一套）：

| 文件 | 场景 |
|---|---|
| `landing-light.webp` / `landing-dark.webp` | 首页首屏（1440×900） |
| `login-light.webp` / `login-dark.webp` | 登录页认证壳（1600×1000） |
| `admin-light.webp` / `admin-dark.webp` | 管理端侧栏品牌位（管理紫） |
| `mark-sizes-16-48.webp` | 16/24/32/48px × 单色（管理紫）/ 彩色（白/午夜蓝），2× DPR |
| `empty-frame-light.webp` / `empty-frame-dark.webp` | 记录页空态取景框 |
| `admin-guard-light.webp` / `admin-guard-dark.webp` | 管理员守卫页（普通用户视角） |
| `record-modal-light.webp` / `record-modal-dark.webp` | 落地页判读记录弹层（纸面原语回归） |
| `canvas-fill-light.webp` / `canvas-fill-dark.webp` | 判读页底部：上=修复前，下=修复后 |
| `mobile-landing-light.webp` / `mobile-landing-dark.webp` | 移动端 390×844 |

## 文档一致性报告

| 文档 | 修正内容 |
|---|---|
| `INTEGRATION.md` | 全部路径改为 `web/public/brand/` 实际文件；尺寸 64/96/192；单色派生规则；回归清单 |
| `PACK-README.md` | 头部「历史资料」标记；`png/icon`、`admin-purple`、单色「挖空中心」口径标注为已被取代 |
| `DESIGN.md` §3.9 | 三色母版共享 alpha；项目内只用 light/dark；单色派生 + 64/96/192；16px 差异 |
| `IRIS_2_DESIGN_REFERENCE_BRIEF.md` | 删除已删 SVG 路径，指向光学标与 INTEGRATION |
| `QA.json` | 五张母版 alpha sha 全部一致；新增 `mono_derivation` 与 `vendor_originals` |
| 本 README | 资产体积改为实测 195.2 KiB；字标前身改为 `--font-serif`（Noto Serif SC） |

## 已知取舍

1. **16px 只能保留外环**：品牌包已声明星点细节在 16px 不可见；单色版在 16px 简化为
   「环 + 心」，管理端实际使用 24px。
2. **管理端用单色版**：品牌块底色本身就是管理紫，紫标压紫底会糊。品牌块底色随主题
   翻转，因此单色标也要两版（白 / 海军蓝）。
3. **字标从衬线改 Manrope**：DESIGN §1.6.1 一直写的是「Manrope 字标」，实现此前用的是
   `--font-serif`（`"Noto Serif SC", …`）；本次对齐规范，宽度略变，不影响布局。
4. **单色版保留明度阶梯**：为保住虹膜结构，单色不是纯色剪影，而是同色相的明度变化
   （white 灰→白、navy 深→中）。轮廓由 alpha 完全锁死，与彩色版一致。
5. 旧 `iris-mark-metallic-*.svg` 已删；如需回滚，`git revert` 对应提交即可。

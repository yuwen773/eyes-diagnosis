# Iris React 接入说明（以本仓库当前实现为准）

> 本文件描述**本仓库已落地的实现**，不是品牌包的通用建议。
> 品牌包 v1.0 的原始说明见 `PACK-README.md`（已标记为历史资料）。

## 资产位置

运行时资产全部在 `web/public/brand/`，由 Vite 原样发布；1024 母版留在
`docs/design/assets/iris-optical-brand-v1.0/` 供追溯，**不进 `public/`**。

| 角色 | 文件 | 展示尺寸 |
|---|---|---|
| 用户端浅色标 | `iris-optical-light-{64,96,192}.png` | 顶栏/页脚 30px，Agent 欢迎屏 56px |
| 用户端深色标 | `iris-optical-dark-{64,96,192}.png` | 同上 |
| 管理端单色（浅色主题用） | `iris-mono-white-{64,96,192}.png` | 侧栏 24px |
| 管理端单色（深色主题用） | `iris-mono-navy-{64,96,192}.png` | 侧栏 24px |
| 浏览器标签栏 | `iris-favicon.ico` | 多尺寸 ICO |
| iOS / Android 主屏 | `iris-app-tile-180.png` | 180px |

## 引用方式

用户端（`web/src/components/shell/Wordmark.tsx`、`web/src/components/agent/WelcomeScreen.tsx`）：

```tsx
<img
  className="wordmark__mark wordmark__mark--light"
  src="/brand/iris-optical-light-96.png"
  srcSet="/brand/iris-optical-light-64.png 64w, /brand/iris-optical-light-96.png 96w, /brand/iris-optical-light-192.png 192w"
  sizes="30px"
  alt="" width={30} height={30}
/>
```

浅色/深色两版同时挂，靠 `html.dark` 规则切换（`app.css`、`agent.css`）。

管理端（`web/src/components/admin/AdminNav.tsx`）：同一结构，换成
`iris-mono-white-*` / `iris-mono-navy-*`，`sizes="24px"`，宽高 24。
紫色留给品牌块底色（`--admin-*`），标本身只用单色。

`web/index.html`：

```html
<link rel="icon" href="/brand/iris-favicon.ico" sizes="any" />
<link rel="apple-touch-icon" href="/brand/iris-app-tile-180.png" />
```

## 单色版派生规则（2026-11-16 起）

单色版**从彩色母版派生**，不再单独绘制近似图形：

- 取 `iris-optical-primary-1024.png` 的 alpha 通道原样保留 → 与彩色版**同一核心轮廓**
  （alpha sha256 `d4f31d69…`，非零 alpha 534,590 px，与 light / dark / admin 紫三色一致）；
- 用母版亮度（p5–p95 归一化）映射单色明度阶梯：
  - `mono-white`：暗区 `#7a7a7a` → 亮区 `#ffffff`（压在管理紫底上）
  - `mono-navy`：暗区 `#08152b` → 亮区 `#4a6ca0`（压在浅紫底上）
- 16px 下内部纹理压缩为可辨的「环 + 心」结构，不再保留镜面细节；管理端实际使用 24px。

派生前的品牌包原始单色母版保留在 `vendor-original/`，仅作来源追溯。

## 必做回归

- Light/Dark 顶栏、页脚、登录/注册、Agent 欢迎屏、管理端侧栏、favicon。
- 16/24/32/48px 实际浏览器与 1x/2x DPR 清晰度；24px 不做自动锐化。
- 灰阶、单色背景、浏览器遮蔽标签场景。
- 单色版与彩色版的 alpha 轮廓一致性（见 `QA.json`）。

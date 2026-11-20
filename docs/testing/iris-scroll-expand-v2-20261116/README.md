# ScrollExpand 蓝光学玻璃 v2 · 视觉证据（2026-11-16）

对应 PR：`feat/scroll-expand-optical-glass`（基于 `ui`）。
资产说明：`docs/design/assets/iris-scroll-expand-blue-optical-v2/README.md`。

## 截图口径

- 栈：`web/` 的 `npm run dev`（Vite），只起前端；落地页不请求后端。
- 浏览器：本机 Playwright 驱动 `chromium_headless_shell-1234`
  （Playwright 1.65 默认的 1254 未安装，故显式指定已安装版本）。
- 主题：进入页面前 `localStorage.setItem("theme", "light" | "dark")`，与
  `ThemeProvider` 的 `storageKey = "theme"` 一致。
- 视口：390 × 844（DPR 2）、768 × 1024、1440 × 900、1920 × 1080。
- 状态：
  - `start`：`.scroll-expand__track` 顶端对齐视口顶（展开进度 0）。
  - `expanded`：滚动到 `trackTop + innerHeight × 0.34 + 2`
    （`scrollDistance = 0.34`，即进度 1）。
- 截图转为 WebP quality 80 存档，仅用于评审，不是产品资源。

## 文件

`{light,dark}-{390,768,1440,1920}-{start,expanded}.webp` 共 16 张。

## 结论

- 四个宽度、双主题下，虹膜都在画面右侧完整呈现，左侧标题区与展开后的说明文字
  对比度正常；`alt` 与 caption 的「示意渲染 · 非真实患者影像」未变。
- 390 × 844 与 1920 × 1080 展开态会出现 16:9 的上下/左右留边，沿用 `ScrollExpand`
  既有的 `object-fit: contain` 行为；暗色版留边为纯黑、画面为深海军蓝，边界可辨但
  不影响可读性。若后续要消掉这条边界，改 `--se-frame-bg`（`ScrollExpand.css`），
  属于另一次 UI 改动，不在本 PR 范围。
- 本 PR 不改任何组件、样式与令牌，只替换两张 WebP 并补文档与证据。
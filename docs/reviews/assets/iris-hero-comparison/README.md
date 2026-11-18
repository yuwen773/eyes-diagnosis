# E-09 · 首屏三方案对照证据（入库部分）

本目录是 Iris E-09「OpticFlow × Prism 三方案真实浏览器对照」的**入库证据子集**。
完整报告：[`docs/reviews/iris-hero-optic-prism-comparison.md`](../../iris-hero-optic-prism-comparison.md)。

## 这里是什么

- **统一外壳下的单版大图**：`matrix-{bleed|contained}-{A|B|C}-{optic|prism|fusion}-desktop-{light|dark}.png`
  —— 三方案用同一份 `LandingHero` 外壳（顶栏 / Logo / 标题 / CTA / 信息卡 / 卡片完全相同），
  只切主视觉渲染策略；`bleed` = `ui@b805377f` 现行全幅构图，`contained` = multiagent 分支壳内构图。
- **对照拼图**：`compare-*.png` —— 同一布局、同一尺寸、同一取帧时点下的三方案并排。
- **原生页面参考**：`native-*.png` —— 两个分支各自的真实首页（未经对照台外壳包裹）。
- **冻结帧 / 降级帧**：`settled-*.png`、`reduced-motion-*.png`、`webgl-disabled-*.png`。
- **元数据摘要**：`manifest-summary.json` —— 每张截图绑定的 commit / 浏览器版本 / 分辨率 / 主题 /
  方案 / 构图 / 动效状态 / 取帧时点 / 时间戳 / SHA-256，以及性能与降级读数。

## 这里没有什么

全量 63 张截图（含 390 / 820 / 1920 视口）、3 段动效录屏与完整 `manifest.json`
在**本地** `target/iris-hero-comparison/`（`target/` 已被 `.gitignore` 忽略，不入库）。
重新生成的命令见报告 §9。

## 怎么看

建议顺序：三版并排拼图 → 三版单版大图 → 手机拼图 → 原生页面 → 降级帧。
所有图片都是**真实 Chromium 渲染的页面截图**，不是设计稿、不是 ImageGen、
不是 CSS 假画面。

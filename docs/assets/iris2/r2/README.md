# Iris 2.0 · Brand Experience R2 视觉证据

> 全部截图来自**真实运行的 React 页面**（`npm run dev`，Chromium 1234，headless
> + SwiftShader WebGL2），不是概念 HTML，也不是设计稿。
> 采集：2026-11-12 · 视口 390 / 768 / 1440 / 1920 × Light / Dark。

## R2-00 · Glass Material Foundation

材质令牌与 `BrandPanel` 变体在首页首屏的落地效果。R2-00 只改材质层，
**光学主视觉本身未改**（那是 R2-01 的范围），所以 Light 模式下光带仍偏淡。

| 文件 | 内容 |
|---|---|
| `r2-00-hero-{390,768,1440,1920}-{light,dark}.jpg` | 首屏全图，四档宽度 × 双主题 |
| `r2-00-card-1440-{light,dark}.jpg` | **Layered Glass** 放大：Hero 信息卡 |
| `r2-00-entries-1440-{light,dark}.jpg` | **Soft Glass** 放大：三张产品入口卡 |
| `r2-00-badge-1440-{light,dark}.jpg` | **Frosted Glass** 放大：右上角光学台状态胶囊 |

**两种材质未在本阶段出图**：
- **Optical Glass** —— 由 WebGL 渲染，R2-01 出对比图；
- **Solid Brand Surface** —— 页脚在 R2-03 才换成品牌实体面。

### 观察记录（如实）

- **Dark**：信息卡与入口卡的透光关系、内侧高光、边缘描边都成立；
  光带从卡片背后透出，卡片不读成不透明深蓝板。
- **Light**：材质结构成立（描边 + 内侧高光 + 轻微背景模糊），但背后画布接近纯色，
  玻璃的「透光层次」还看不出来——这正好是 R2-01 要解决的前提：
  **先让光带在亮色环境可辨，玻璃才有东西可透**。
- 四档宽度 × 双主题均无 console 错误。

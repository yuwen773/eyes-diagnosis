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
- **Optical Glass** —— 由 WebGL 渲染，R2-01 出对比图（见下节）；
- **Solid Brand Surface** —— 页脚在 R2-03 才换成品牌实体面。

### 观察记录（如实）

- **Dark**：信息卡与入口卡的透光关系、内侧高光、边缘描边都成立；
  光带从卡片背后透出，卡片不读成不透明深蓝板。
- **Light**：材质结构成立（描边 + 内侧高光 + 轻微背景模糊），但背后画布接近纯色，
  玻璃的「透光层次」还看不出来——这正好是 R2-01 要解决的前提：
  **先让光带在亮色环境可辨，玻璃才有东西可透**。
- 四档宽度 × 双主题均无 console 错误。

## R2-01 · Optic Glass Fidelity

「优化前」= PR #52 头（`5194f10`）的同一页面、同一视口、同一静止状态。
只替换了首屏光照相关的五个文件（`OpticFlow.tsx` / `beamsEngine.ts` /
`LandingHero.tsx` / `BrandPanel.tsx` / `brand.css`），其余代码与「优化后」完全相同。

| 文件 | 内容 |
|---|---|
| `r2-01-before-{band,hero}-1440-{light,dark}.jpg` | **优化前**：一团没有边界的蓝色雾 |
| `r2-01-after-{band,hero}-1440-{light,dark}.jpg` | **优化后**：连续带体、可见纤维、边缘高光 |
| `r2-01-hero-{390,768,1920}-{light,dark}.jpg` | 其余三档宽度的首屏全图 |
| `r2-01-band-paused-1440-{light,dark}.jpg` | 点真实「暂停动效」按钮后的画面 |
| `r2-01-band-reduced-1440-{light,dark}.jpg` | `prefers-reduced-motion: reduce` 下的画面 |
| `r2-01-band-static-1440-{light,dark}.jpg` | 禁用 WebGL2（`getContext('webgl2')` 返回 null）时的 SVG 降级画面 |

### 观察记录（如实）

- **亮色**：带体从「无边界雾团」变成可辨认的纤维玻璃带——有鞘、有厚度、
  有银白外缘；光带从卡片背后穿过，卡片的模糊与内侧高光因此读得出来。
- **暗色**：带体是**另一种材质**（冰蓝加光），不是亮色的反相；
  WebGL 提供环境极光，纤维带提供形体。
- **降级**：禁用 WebGL2 后 `data-mode` 变为 `static`，画面仍有同一束纤维带，
  只是没有环境光；`prefers-reduced-motion` 下 `data-mode` 为 `paused`，构图不变。
- **控制台**：四档宽度 × 双主题 × 四条路径，无 console 错误。

### 性能（SwiftShader 软渲染，只作相对比较）

页面内 `requestAnimationFrame` 采样 180 帧，1440 × 900：

| 主题 | 优化前 median / p95 | 优化后 median / p95 |
|---|---|---|
| Light | 50.1 / 58.5 ms | 58.5 / 108.5 ms |
| Dark | 58.4 / 66.8 ms | 66.8 / 108.5 ms |

**这不是 GPU 上的数字**：headless Chromium 用 SwiftShader 做 CPU 光栅化，
带混合模式的 SVG 图层在软件合成下比真实 GPU 贵得多。多次采样的绝对值有
±5 ms 抖动，这里记的是典型一次。真实设备上的帧率**未在本轮测量（NOT RUN）**——
没有可用的真机或带 GPU 的浏览器环境。

资源体积：本轮**没有新增依赖**（`web/package.json` 相对 `5194f10` 无差异）。
两份源文件的体积变化：

| 文件 | 源码（gzip） | 优化前 | 优化后 | 增量 |
|---|---|---|---|---|
| `OpticFlow.tsx` | 3,308 B | 4,217 B | +909 B |
| `brand.css` | 3,167 B | 4,944 B | +1,777 B |

合计 gzip **+2.7 KB**（其中一半是 R2-00 的材质令牌与 `brand-panel` 规则）。

## R2-02 · Floating Brand Header

品牌变体顶栏（`BrandHeader`）：字标 + 中央悬浮胶囊 + 右侧功能区（主题 / 账号 / 主 CTA）。
胶囊是 **Frosted Glass**，当前路由是实心钴蓝胶囊；`.site-head` 一行未改，
临床页 / 管理端 / 协作台仍是各自的顶栏。

| 文件 | 内容 |
|---|---|
| `r2-02-home-{1440,768,390}-{light,dark}.jpg` | 首页视口截图（含顶栏），三档宽度 × 双主题 |
| `r2-02-news-1440-{light,dark}.jpg` | `/news`：当前路由高亮胶囊（「03 新闻资讯」） |
| `r2-02-drawer-open-390-{light,dark}.jpg` | 移动端抽屉打开态（复用既有 `MobileNav`） |

### 实测（浏览器里量出来的，不是估的）

| 项 | 结果 |
|---|---|
| 390px 触控目标 | 主题切换 **44×44**、汉堡 **44×44** |
| 390px 桌面胶囊 | `display: none`（不压缩塞入），右侧只留主题与汉堡 |
| 抽屉打开 | 焦点进入抽屉 = true；`body.overflow = hidden` = true |
| Escape 关闭 | `data-open="false"`，焦点回到汉堡 = true，`body.overflow` 复原 = true |
| 当前路由胶囊 | `/news` 上读到 `03 新闻资讯`（`aria-current="page"`） |
| console | 双主题 × 三档宽度，无错误 |

### 观察记录（如实）

- **反相分支本轮未被触发**：浅色主题下首页没有 `data-head-invert` 深色区段
  （`ScrollExpand` 的舞台按主题取 `tone`，浅色主题下就是 `light`）；
  暗主题整页由 `html.dark` 令牌负责，胶囊本来就是暗色玻璃。
  也就是说「浅色主题滚到深色区段时换令牌」这段写法**本轮没有实际画面证据**，
  只有代码路径；R2-04 若在浅色主题下引入深色区段，需要补一次截图。
- 为让 `ScrollExpand` 能正确量顶栏高度，品牌顶栏带了 `data-site-head` 标记
  （纯测量钩子，不带任何样式，与 `.site-head` 类无关）。

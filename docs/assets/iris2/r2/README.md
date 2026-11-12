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

## R2-03 · Brand Footer

`BrandFooter`：**Solid Brand Surface**（深海蓝实体面，全幅铺满），三层信息架构。
不做整块玻璃模糊，也不挂任何 GPU 特效。

| 文件 | 内容 |
|---|---|
| `r2-03-footer-1440-{light,dark}.jpg` | 桌面页脚整体 |
| `r2-03-footer-390-{light,dark}.jpg` | 390px 整屏（页脚 + 上方过渡） |

### 实测（`getComputedStyle` + 真实点击）

| 项 | Light | Dark |
|---|---|---|
| 页脚底色 | `rgb(10, 26, 51)` | `rgb(7, 17, 32)` |
| 页面底色 | `rgb(243, 244, 241)` | `rgb(11, 13, 12)` |
| 免责文字色 | `rgb(159, 179, 207)` | 同值 |

- **链接清单**：`/diagnosis` `/agent` `/news` + 6 个页面锚点（`#specimen` `#how`
  `#record` `#agent` `#bounds` `#start`），逐个查过目标节点都存在；
  外加 `#top`（组件内 `preventDefault` + `scrollTo`，页面上本就没有这个锚点）。
  **没有**隐私政策 / 法律声明 / 联系方式 / 支持中心这类不存在的页面。
- **返回顶部**：`prefers-reduced-motion: no-preference` 时点击后 120ms 仍在滚动
  （7696 → 7563，平滑）；`reduce` 时同一时刻已到 `scrollY = 0`（瞬时）。
- **与主体分离**：浅色页面下是一块明确的深色区块；暗色下 `#071120` 与页面
  `#0b0d0c` 之间有线与明度差，不会融进背景消失。
- **既有规格未删**：EFFICIENTNET-B4 / 8 CLASSES / QUALITY GATE / SHA-256 WEIGHTS
  都保留，只是从一条读数行改到「平台」列。

## R2-04 · Full-page Brand Unification

**做法**：新增一个**受控的品牌页作用域** `.is-brand-page`，只挂在落地页根上。
它**只换画布与发丝线**（`--field` / `--bg` / `--line` / `--line-strong`），
不碰 `--ink` / `--fg` / `--signal` / `--risk-*` / `--paper-*`。
于是上半页的钴蓝光学台、下半页的章节、记录纸、Agent 演示、页脚落在**同一块银蓝画布**上，
而临床语义色与纸面原语一点没动。逐条收口的只有三处场景遗留色：
章节短码（橙 → 钴蓝）、收尾 CTA（墨色 → 钴蓝）、记录纸在暗色下改回白纸。

**没有**改管理端、Agent 工作台、Clinical 页面的任何样式——`.is-brand-page` 是落地页专属。

| 文件 | 内容 |
|---|---|
| `r2-04-full-{390,768,1440,1920}-{light,dark}.jpg` | 完整首页，四档宽度 × 双主题（8 张） |
| `r2-04-section-{light,dark}-{03,05,08,10}.jpg` | 1440px 逐区截图：影像舞台 / 八类覆盖 / 记录纸 / Agent 与边界 |

### 实测

| 项 | 390 | 768 | 1440 | 1920 |
|---|---|---|---|---|
| 横向滚动 | 无 | 无 | 无 | 无 |
| 失效锚点 | 0 | 0 | 0 | 0 |

双主题四档宽度共 8 次加载，console 错误 0。

### 观察记录（如实）

- **整页截图有已知拼接瑕疵**：Playwright 的 `fullPage` 会把页面重排成整页高度再拍，
  `100svh` 一类的高度与 IntersectionObserver 的懒加载区块会跟着变，
  所以 `r2-04-full-*.jpg` **页尾会重复一条顶栏/首屏带**。
  这是截图手段的产物，不是页面重复——DOM 里 `.landing-hero` / `[data-brand-head]` /
  `.brand-foot` 各只有 1 个。逐区证据以 `r2-04-section-*` 为准。
- **记录纸在暗色下改回白纸**：原来落地页按主题在 `tone="night"` 与 `tone="paper"`
  之间切换，暗色下列读记录变成深色面板——与页面文案「写在同一张纸上」和
  「纸面原语不参与主题翻转」都不一致。现在固定 `tone="paper"`，
  暗色页面上它正好是那座白色内容区。
- **ScrollExpand 未改**：判读舞台仍是独立的深色观察画布（R2-04 明确要求保留）。
- 品牌页画布用的是 `--brand-canvas`；浅色 `#f2f6fc`、暗色 `#0b1425`。

## 全局验收 · 十条动效 / WebGL 路径

在真实浏览器（Chromium 1234 + SwiftShader WebGL2，1440 × 900）里逐条操作并读取真实状态，
没有通过注入样式伪造结果。第 10 条用真实 `WEBGL_lose_context` 与 `visibilitychange`
事件驱动，绘制次数通过包装 `WebGL2RenderingContext.prototype.drawArrays` 统计。

| # | 路径 | 结果 |
|---|---|---|
| 01 | 正常运行 | `data-mode="live"`，canvas 1 个（StrictMode 未重复挂载），console 0 错误 |
| 02 | 用户手动暂停 | 点击真实「暂停动效」按钮 → `paused`，纤维位移停止 |
| 03 | `prefers-reduced-motion`（首载） | `paused`，纤维位移停止 |
| 04 | 运行中实时切到 reduce | `live → paused`，当场生效（不等重新挂载） |
| 05 | WebGL2 不可用 | `static`，静态纤维带存在，页面可读 |
| 06 | 运行中上下文丢失 | `WEBGL_lose_context().loseContext()` → `static` |
| 07 | 离屏 | 滚到页底后纤维层 `is-drifting` 移除 |
| 08 | 路由离开再返回 | 返回后 `live`，canvas 1 个，console 0 错误 |
| 09 | 主题切换 | `live` 不变，canvas 仍 1 个（换参数不重建引擎） |
| 10 | 标签页隐藏 / 恢复 | 隐藏后 600ms `drawArrays` **0** 次；恢复后重新绘制（20 次/600ms） |

第 10 条的「运行中」基线是 14 次 / 600ms——这是 SwiftShader 软件光栅下的帧率，
不代表真实 GPU 表现；本表只用来证明**隐藏时确实停止绘制**。

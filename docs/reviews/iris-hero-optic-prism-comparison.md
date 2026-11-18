# Iris E-09 · OpticFlow × Prism 三方案真实浏览器对照

> **状态：`VISUAL_REVIEW_PENDING`**。本报告只交证据与建议，**不代替产品负责人的最终决定**，
> 也不自行把 E-09 标成 APPROVED。
>
> | 项 | 值 |
> |---|---|
> | 证据分支 | `local/e09-hero-compare-20261118`（本地隔离候选，**未推送、未合并**） |
> | 应用代码 commit | `add10bb9`——`web/src` 自 `ecb9d5fc` 起未再改动，manifest 里每张截图的 `commit` 都指向它 |
> | 取证脚本 | `web/scripts/evidence/hero-compare.mjs` @ `541b070`，SHA-256 `1adb8d0a4841…` |
> | 基线 · 方案 B（Prism） | `b805377f`（= `origin/ui`） |
> | 基线 · 方案 A（OpticFlow） | `feat/iris21-multiagent-integration@9a6dbcb6` |
> | 取证日期 | 2026-11-18（截图 07:16:32Z，性能复测 07:21:25Z） |
> | 证据目录 | `docs/reviews/assets/iris-hero-comparison/`（入库）<br>`target/iris-hero-comparison/`（全量 + manifest，本地） |
> | 报告 | `docs/reviews/iris-hero-optic-prism-comparison.md` |

---

## 0. 结论速览（先看这段）

**建议：先不要冻结 C。** 方向（OpticFlow 的连续光带 × Prism 的棱镜色散）值得继续，
但当前这一版 C 在三个地方比 A 更差，而且都能改：

1. **色散扇冲出玻璃外壳**（1440 桌面冲出右上角、390 手机冲出视口右/下边缘）——
   与 `DESIGN.md` §3.6「光带与细纤维被裁在壳内」直接冲突。
2. **棱镜在 Light 主题下读成线框**（内部近乎透明，只剩一圈蓝色轮廓），暗色下却是全场最强的主角——
   两套主题的「主角」不是同一个东西（§4 判据 3 / 6）。
3. **动效没有「5 秒自动停」**：A 与 C 都是无限循环，`DESIGN.md` §3.7 要求「intro 后自动旋转
   约 5 秒即停（`data-mode="settled"`），不设手动控件」；只有 B 做到了。
   multiagent 分支还给 A 加了手动「暂停动效」徽章，同样违规。
   （引擎本身**能**停机——手动暂停后实测 draws/s 会归 0，§6.3 有代码级解释；
   缺的是那个「到点自动停」的窗口。）

**如果只按当前截图选，A（OpticFlow）是三版里最稳的一版**；C 修掉上面三条（都是小改动，
不涉及换渲染器、不涉及第二个 GPU 循环）之后，会明显强于 A。
B（Prism）是现行生产首页的视觉，它的两个硬伤是：**壳内构图下画布会露出硬边矩形**，
以及**暗色下整块泛白、失去「精密仪器」感**。

另外有一条与选型无关、但必须一起决策的事：`DESIGN.md` §3.6「首屏构图（全文档唯一口径）」
写的是**画布全幅 + 光带裁在壳里**，而两条分支各自只做到一半（§6）。这个口径要先定，
否则「哪个方案更好」没有稳定的比较基准。

---

## 1. 本轮做了什么、明确没做什么

### 做了

| # | 事项 | 落点 |
|---|---|---|
| 1 | 取回方案 A 的**逐字原件**（`OpticFlow.tsx` / `beamsEngine.ts` / `beamsMount.ts`） | 从 `feat/iris21-multiagent-integration@9a6dbcb6` 取回，SHA-256 与来源分支一致（见 §3.3） |
| 2 | 建一个 dev-only 对照台，A/B/C 共用同一个 React 外壳，只切主视觉策略 | `web/src/pages/DesignHeroComparePage.tsx`、`web/src/components/brand/HeroCompareStage.tsx` |
| 3 | 新写方案 C（`HeroFusion`）：Beams 光场 + SVG 棱镜色散，**只有一个 WebGL 循环** | `web/src/components/brand/HeroFusion.tsx` / `.css` |
| 4 | 真实 Chromium（headful）取证：核心矩阵、原生页面参考、冻结帧、Reduced Motion、WebGL 降级、性能与资源回收、录屏、对照拼图 | `web/scripts/evidence/hero-compare.mjs` |
| 5 | 许可与第三方来源核对 | `web/src/components/brand/THIRD-PARTY-NOTICES.md`、`notices.test.ts` |

### 明确没做（按任务约束）

- **没有修改或合并** `ui`、PR #87、PR #100。
- **没有改生产首页 `/`**：对照台是独立路由；正式构建里既没有这条路由，也没有任何
  `DesignHeroComparePage` chunk（§3.5 有验证命令）。
- **没有把设计入口暴露到生产路由**。
- **没有引入** Three.js / React Three Fiber / `@react-three/*` / 任何新动效库。
- **没有复制任何未授权的第三方组件源码**（§3.6）。
- **没有推送、没有合并、没有把 E-09 标成 APPROVED**。
- 没有覆盖 R5 联合候选的未提交工作，也没有新建重复工作树、没有改写共享历史：
  全部改动都在 `.worktrees/r5-joint-v2` 的 `local/e09-hero-compare-20261118` 分支上。

---

## 2. 三个「同一个东西」，以及它们各自独立的东西

公平比较的前提是把「渲染器差异」和「其它差异」分开。本轮的做法：

| 层 | 三方案是否相同 | 说明 |
|---|---|---|
| 顶栏、Logo、Manrope、标题、副标题、CTA、右侧信息卡、入口卡、页面宽度 | **完全相同** | 外壳逐字取自 `b805377f` 的 `LandingHero`，一处没改 |
| 主题、色彩令牌、截图时点 | **完全相同** | 同一份 `tokens.css`；动效帧统一取「渲染器进入 live 后第 3000 ms」 |
| 渲染器 | **不同** | A = Beams（`ui` 之外，multiagent 分支）；B = Prism（`ui`）；C = Beams + SVG 光学层 |
| 首屏构图 | **分两组各测一遍** | 「全幅」（`ui` 现行）与「壳内」（multiagent 分支）——两条分支本来就不同构，不能只测一种然后把差异算到渲染器头上 |

与原生页的差别只有两处，都是为了公平，且对三个方案一视同仁：

- 去掉 OpticFlow 原生页那个「暂停动效」徽章（Prism 没有这个控件，留着等于给 A 多一块玻璃；
  暂停改由对照台工具栏统一提供）。
- 不改任何字号、间距、卡片位置与缩放。

---

## 3. 取证方法

### 3.1 脚本与产物

`web/scripts/evidence/hero-compare.mjs`（**新增**，没有覆盖既有的 `hero-prism.mjs`）：

- 真实 Chromium，**headful** 启动（软件光栅下 Prism 几乎不发光，会得到「没渲染」的错误结论）。
- 注入脚本计数：`window.__webgl2Created`（WebGL2 上下文数）、
  `window.__drawCalls`（`drawArrays` 调用数，可选禁用 WebGL）。
- 每张截图绑定：commit、浏览器版本、分辨率、主题、方案、构图、动效状态、取帧时点、
  截图时间、文件 SHA-256、控制台错误、失败请求、横向溢出、GPU 渲染器字符串、画布缓冲尺寸。
- 性能段可**单独复测**：`HERO_COMPARE_PERF_ONLY=1` 只重跑性能与降级读数，
  截图沿用上一轮、结果并回同一个 `manifest.json`（`capturedAt` 与 `perfMeasuredAt`
  分开记录）。原因是性能段紧跟 60 次截图之后跑，机器负载会污染横向比较（§5.3）。

产物：

- `docs/reviews/assets/iris-hero-comparison/` —— 入库的桌面核心截图、降级帧、原生参考与对照拼图。
- `target/iris-hero-comparison/` —— 全量截图、`manifest.json`（含全部元数据与性能读数）、
  `manifest-summary.json`、`performance-in-pipeline.json`、`video/`（录屏）。
  `target/` 已被 `.gitignore` 忽略。

### 3.2 矩阵与取帧时点

- 核心矩阵：**3 方案 × 4 视口（390×844 / 820×1180 / 1440×900 / 1920×1080）× 2 主题 × 2 构图 = 48 张**，
  超过「3 方案 × 3 视口 × 2 主题 = 18 张」的下限。
- 动态画面统一取「进入 live 后第 3000 ms」，三方案同一时点；另各取一张**冻结帧**
  （A/C 用 `?paused=1`，B 等过 Prism 的 5 秒自动停机窗口），避免「一版刚加载、另一版已静止」。
- 另外：原生 OpticFlow / 原生 Prism 页面参考各 2 张（桌面亮/暗）+ 2 张补充；
  Reduced Motion 3 张；WebGL 不可用 3 张；动效录屏 3 段（5 s/方案）；对照拼图 10 张。

### 3.3 方案 A 是逐字原件（不是复刻），方案 B 一行未改

比对方式：把两边的字节流统一成 LF 后取 SHA-256（Windows 工作区检出是 CRLF，
不归一化会比出假差异）。

| 文件 | 来源 | SHA-256（来源 / 本分支） |
|---|---|---|
| `OpticFlow.tsx` | `feat/iris21-multiagent-integration@9a6dbcb6` | `4b139b040c0e…` / `4b139b040c0e…` ✅ 一致 |
| `beamsEngine.ts` | 同上 | `97233ff964f5…` / `97233ff964f5…` ✅ 一致 |
| `beamsMount.ts` | 同上 | `673a7e3129f3…` / `673a7e3129f3…` ✅ 一致 |
| `HeroPrism.tsx` | `b805377f`（= `origin/ui`） | `5d7ef00a1890…` / `5d7ef00a1890…` ✅ 一致 |
| `Prism.tsx` | 同上 | `3c2d7788c974…` / `3c2d7788c974…` ✅ 一致 |
| `Prism.css` | 同上 | `5810e2664c1e…` / `5810e2664c1e…` ✅ 一致 |
| `LandingHero.tsx`（统一外壳） | 同上 | `585f68d8931c…` / `585f68d8931c…` ✅ 一致 |
| `BrandPanel.tsx`（右侧信息卡） | 同上 | `2bde1f2c394c…` / `2bde1f2c394c…` ✅ 一致 |

`brand.css` 里那段 `.optic-flow*` 光学带样式同样逐字取回（+200 行）。
**方案 B 就是 `b805377f` 现行的 `HeroPrism` + `Prism`，本轮一行未改**——所以同一份构建
既能当 B 的对照台，也能当 B 的原生参考。

> 注：本地 `ui` 分支在本轮之前已经陈旧（停在 2026-11-16 的三个本地提交上，
> 与 `origin/ui` 分叉），所以本文一律用**提交 SHA** `b805377f` 指代基线，
> 不用 `ui@…` 这种已经解析不到的写法。`origin/ui` 至今仍是 `b805377f`，本轮未动。

### 3.4 方案 C 的技术形状

- **一个 WebGL 循环**：动态光场用 vendored Beams 引擎（裸 WebGL2）；
  棱镜、色散扇、细纤维是同一张画面上的 **SVG 层**，不引 Three.js / R3F。
- 入射线**直接复用 A 的玻璃体样式**（`.optic-flow__sheath` / `.optic-flow__fiber-set*` /
  `optic-stop--*`），所以「融合」不是两个特效并排：入射线与 A 是同一条带，
  只是它在棱镜处被散成彩色细光。
- 降级路径（`HeroFusion.test.tsx` 有契约测试）：
  Reduced Motion 冻结（`data-mode="frozen"`）、WebGL2 不可用 / 着色器失败 / 上下文丢失 → 静态降级、
  离屏与标签页隐藏停机、卸载时 `dispose()` 回收 GPU 资源、低性能设备降 `quality` / `dpr`。
- 切方案时旧组件被卸载、它自己的 `dispose()` 回收资源，**同一时刻最多一个渲染循环**。

### 3.5 生产构建不含设计入口（实测）

```bash
cd web && npx vite build --outDir <tmp> && grep -rl "hero-compare" <tmp>   # 无输出
ls <tmp>/assets | grep -i design                                            # 无输出
ls <tmp>/assets | grep -i "DesignHeroCompare\|HeroCompare"                  # 无输出
```

对照台路由只在 `import.meta.env.DEV` 或构建期 `VITE_DESIGN_PREVIEW=true` 时注册
（`web/src/App.tsx`）。本轮取证用的就是带 `VITE_DESIGN_PREVIEW=true` 的构建；
上面这三条命令在**不带**该变量的生产构建上跑，产物 170 个 asset 里没有任何
`hero-compare` 字符串。

### 3.6 第三方许可

`web/src/components/brand/THIRD-PARTY-NOTICES.md` 已核对并补全：

- **React Bits · Prism**（方案 B）：MIT + Commons Clause v1.0，作者 David Haz。
- **React Bits · Beams**（方案 A 与 C 的光场）：同一上游、同一份 LICENSE，
  固定 commit `ed33ebe4acfe29e60fb759bcccc70a138ce2dcef`，逐字比对表已在文件里。
- 2026-11-16 产品负责人对 Prism 的**公开源码分发风险接受**，本轮明确延伸到 Beams
  （同一上游、同一许可）。
- **方案 C 没有复制任何新的上游源码**：棱镜、色散扇、细纤维全部自研 SVG / CSS。
- `package.json` 本轮**没有新增任何依赖**。

---

## 4. 视觉评审（10 条判据）

判据逐条来自任务书。评分基于 §3 的截图与代码证据；**不因为预选 C 就给 C 最高分**。

| # | 判据 | A OpticFlow | B Prism | C OpticFlow × Prism | 判据依据（截图） |
|---|---|---|---|---|---|
| 1 | Iris 品牌辨识度 | **高** | 中 | 中高 | A 的细纤维光带把「Iris 光学虹膜」字面化，是冷静精密的仪器感；B 是泛光雾，看不出光学器件；C 加了棱镜，符号更直白，但也更「示意图」 |
| 2 | 钴蓝 / 青 / 紫的协调性 | **高** | 中 | 中 | A 只有钴蓝→青 + 银白反光，无杂色；B 的 Light 版右侧偏紫、暗部偏灰蓝；C 的色散扇把紫与琥珀引进来，Light 下最跳 |
| 3 | 光学材质与空间层次 | **高** | 低 | 中 | A 有玻璃鞘 + 纤维 + 边缘高光 + 焦散四层厚度；B 是一整片雾，没有可辨认的材质边界；C 的棱镜在 Light 下内部近乎透明（乳白面 0.52 落在浅底上看不出），只剩一圈蓝色轮廓 |
| 4 | 视觉冲击力 | 中高 | 中 | **高**（暗色）/ 中（亮色） | C 暗色版棱镜 + 七色扇是三版里唯一有明确焦点的画面；Light 版焦点被稀释 |
| 5 | 正文与 CTA 可读性 | **高** | **高** | **高** | 三者的棱镜/光带/光场均不压标题与 CTA，文字区都干净。差别在别处：A 的光带横穿 CTA 下方但极淡；B 的画面明暗不均（右下角把骨白底染成紫）；C 的扇会冲出壳外（见判据 7 与 R-3） |
| 6 | Light / Dark 一致性 | **高** | 中 | 中低 | A 是两种材质（冰川银蓝 / 深海钴蓝），不是反色；B 暗色下整体偏灰白；C 的 Light 版棱镜几乎不可见、Dark 版是全场主角 → 两套主题的主角不是同一个东西 |
| 7 | 移动端裁切与布局 | **高** | 高 | **低** | 390 下 C 的棱镜被切在视口底边、色散扇冲出右侧与底部；细射线还会从 INTELLIGENCE LAYER 卡右侧穿过（仍是细线，文字可读）。A、B 在 390 下都干净 |
| 8 | 动画流畅与设备负载 | 中高 | 中高 | **高**（但差距很小） | 空载两次独立复测：A 73.6 / 73.9 fps、B 76.3 / 79.1 fps、C 79.3 / 83.0 fps，p95 帧时间 22.8 / 22.8 / 18.3 ms，**三者无长任务**。差距在 10% 量级，不构成「谁更流畅」的定论（§5.3 有负载污染分析）。三者停机后 draws/s 均为 0 |
| 9 | Reduced Motion 与降级质量 | 通过 | 通过（**自动停机**） | 通过 | 三者实测 2 s 内 **0 draw call、0 个 CSS 动画**；WebGL2 不可用时均切 `data-mode="static"`（ctx=0）。Reduced Motion 下 A 的 `data-mode` 是 `paused`（Beams 的暂停态）、B / C 是 `frozen`（各自的冻结态）——**名字不同，行为一致：当场停**。差别在常态：A / C 没有「5 秒后自动停」 |
| 10 | 与既有顶栏 / Logo / 管理端语言统一 | **高** | 中 | 中 | A 的细纤维、等宽读数与骨白工作台同族；B 的柔雾更像消费级氛围页；C 的线框三角与「克制台账」的管理端语言距离更远 |

### 4.1 全局检查

- **无横向溢出**：63 张截图（含 48 张矩阵）`horizontalOverflow` 全为 `false`。
- **无页面异常**：控制台错误与失败请求在 manifest 里逐张记录（§5 末尾）。
- **无错误资源请求**：见 §5 末尾汇总。

---

## 5. 性能与资源回收（实测）

同一台机器、同一个 Chromium、同一构建、1440×900 亮色、每个方案 3 段 1 s 采样。

| 方案 | 动效中 FPS（中位 / 最低） | p95 帧时间 | 掉帧 | 长任务 | 动效中 draws/s | 停机后 draws/s | 离屏 draws/s |
|---|---|---|---|---|---|---|---|
| A OpticFlow | 73.9 / 72.5 | 22.8 ms | 24 / 223 | 无 | 148 | 0 | 0 |
| B Prism | 79.1 / 78.9 | 22.8 ms | 25 / 240 | 无 | 80 | 0 | 0 |
| C OpticFlow × Prism | 83 / 74 | 18.3 ms | 8 / 243 | 无 | 168 | 0 | 0 |

> 这张表是「**空载独立复测**」那一轮的读数（`HERO_COMPARE_PERF_ONLY=1`；manifest 里
> `perfMeasuredAt` = 2026-11-18T07:21:25Z，截图那一轮的 `capturedAt` = 07:16:32Z）。
> 为什么不用跑截图那一轮的读数——见 §5.3。

「停机后」的口径：A / C 是「点完暂停动效 → 指针移出画布 → 等 4.2 s → 采样 2 s」；
B 是「等过 Prism 的 5 s 自动停机窗口 → 采样 2 s」。

「暂停瞬间」与「全新暂停态」两列只对 A / C 有意义（Beams 引擎），B 没有手动暂停概念：

| 方案 | 点完暂停后 1 s 内 draws/s | 全新以暂停态打开 draws/s | 读法 |
|---|---|---|---|
| A OpticFlow | 162 | 0 | 「暂停」只停状态推进，rAF 还要等指针参与度衰减完才收尾 |
| B Prism | — | — | B 无手动暂停态（Prism 的 noise 在 settle 时被置 0，循环自然收尾） |
| C OpticFlow × Prism | 186 | 0 | 「暂停」只停状态推进，rAF 还要等指针参与度衰减完才收尾 |

资源回收与切换（同一轮实测）：

| 方案 | 离开首屏后 | 换主题 | WebGL2 上下文 |
|---|---|---|---|
| A OpticFlow | draw calls 1442 → 1442；canvas 0；hero 0；**停止绘制 是** | 新增上下文 0；画布数 1；hero 主题 dark | 页面内累计 2（同一时刻只有 1 个在用） |
| B Prism | draw calls 389 → 389；canvas 0；hero 0；**停止绘制 是** | 新增上下文 0；画布数 1；hero 主题 dark | 页面内累计 2（同一时刻只有 1 个在用） |
| C OpticFlow × Prism | draw calls 1626 → 1626；canvas 0；hero 0；**停止绘制 是** | 新增上下文 0；画布数 1；hero 主题 dark | 页面内累计 2（同一时刻只有 1 个在用） |

### 5.1 关于「软件渲染」的说明

- **GPU 渲染器**：`ANGLE (AMD, AMD Radeon(TM) Graphics (0x0000164E) Direct3D11 vs_5_0 ps_5_0, D3D11)`——真实硬件光栅（ANGLE / Direct3D11），**不是 SwiftShader 软件渲染**，也不是 WebGL 不可用。
- 画布缓冲：A / C 为 `2160×1176`（CSS 1440×784，dpr 1）；B 为 `1080×588`（CSS 1440×784）。
- 机器：16 逻辑核；浏览器 151.0.7922.34（headful）。

### 5.2 全局检查汇总

- **横向溢出**：63 张截图里 `horizontalOverflow=true` 的有 **0** 张。
- **控制台错误**：0 张有。
- **失败请求**：63 张有，全部是同一条 `GET /api/user/get/login`（对照台与原生页面都跑在**没有后端**的静态预览上，登录态探测被中止）。它在**原生页面**（4173 / 4174）上同样出现，与本次改动无关，也不是渲染资源失败。
- **同一时刻多于一个 WebGL2 上下文**：0 张有。（manifest 里的 `webgl2Contexts` 是页面累计值，换页后重新计数；逐方案的实际并发上下文数见 §5 表格。）

### 5.3 读数的可信度：机器负载会污染横向比较

同一段代码、同一台机器，三方案的性能读数在**不同机器负载下**差出 20 fps。
这不是「某个方案更慢」，是**测量方法的问题**，必须写清楚：

| 测量 | A | B | C | 说明 |
|---|---|---|---|---|
| 跑截图那一轮（perf 段紧跟 48 张矩阵截图之后） | 55.7 | 67.4 | 75.9 | 浏览器刚做完 60 次截图，GPU 内存与 GC 压力未散；A 最先测、B 其次、C 最后——**测序与负载下降同向**，横向比较不可信 |
| 空载独立复测 · 第 1 次 | 73.6 | 76.3 | 79.3 | `HERO_COMPARE_PERF_ONLY=1` |
| 空载独立复测 · 第 2 次（= §5 表） | 73.9 | 79.1 | 83.0 | 同上 |
| 定向探针（隐藏 SVG 叠层前 / 后） | 74.4 / 90.1 | — | 77.5 / 94.3 | 单独开浏览器测，不受取证流水线影响 |

**结论**：

1. 三者的流畅度差异**在 10% 量级**（空载下 A ≈ 74、B ≈ 76–79、C ≈ 78–83 fps），
   **不足以据此判定谁「更流畅」**。C 略高、A 略低，两次独立复测方向一致，
   但差值只有个位数 fps，更像渲染负载的细微差别而不是量级差别。
2. 上一轮报告里那种「A 明显卡、C 明显顺」的观感，**是负载假象**。
   在真实用户的机器上（浏览器刚打开页面，没有几十张截图的负担），
   A 不会比 C 卡 20 fps。
3. 成本主要在 **SVG 叠层与混合**，不在 WebGL 场：把叠层 `display:none` 之后，
   A 从 74.4 → 90.1 fps、C 从 77.5 → 94.3 fps，两者各涨约 16 fps；
   而 A / C 的 Beams 参数（场分辨率 `quality 0.75`、`dpr 1.5`、画布 2160×1176）**完全相同**。
   → 想再要帧率，先砍 SVG 叠层（尤其 `mix-blend-mode` 与大面积半透明渐变），
   不要去动 WebGL。
4. 拿不准时，本报告给读数的优先级是：**能复现 > 数值好看**。两次独立复测的数字
   都写在这里，取证流水线内那一轮的数字也保留在
   `target/iris-hero-comparison/performance-in-pipeline.json`，供交叉核对。

**关于「同一时刻最多一个主动 WebGL 渲染循环」**：63 张截图的 `webgl2Contexts`
在**单次页面加载**下全部是 **1**——对照台切方案时旧组件被卸载、它自己的 `dispose()`
回收资源，因此任何时刻只有一个渲染器活着。性能段里出现的累计值 2 是
「首次挂载 1 次 + SPA 回退后重新挂载 1 次」，不是并发。

---

## 6. 与 `DESIGN.md` 的对照（这一节可能比选型更重要）

### 6.1 首屏构图：文档写的是第三种组合

`DESIGN.md` §3.6「首屏构图（全文档唯一口径）」原文：

> **外层画布全幅**铺满视口宽度（银蓝 / 午夜蓝），**玻璃外壳**是 `--maxw`（1240px）
> 版心内的 `--radius-2xl` 容器，光带与细纤维被**裁在壳内**，不溢出到页面边缘。
> 标题、CTA、流程卡都在这层壳里；壳外只有画布本身。**不是**「把整个视觉缩成一个小窗」，
> 也**不是**「光带直接铺满整页、把文字压在上面」。

两条分支各自只做到一半：

| 实现 | 画布全幅 | 光带裁在壳里 | 与 §3.6 的关系 |
|---|---|---|---|
| `b805377f`（Prism，全幅） | ✅ | ❌ 光带铺满整页、压在文字下面 | 落在「不是…」那句的反例里 |
| `feat/iris21-multiagent-integration`（OpticFlow，壳内） | ❌ 画布也缩在壳里 | ✅ | 接近，但「不是把整个视觉缩成一个小窗」那句又对不上 |
| 本报告的 `contained` 对照组 | 画布与光带都在壳内 | ✅ | 与 multiagent 一致，供对照用 |

**这是选型的前置问题**：如果 §3.6 是硬口径，那么构图必须改回壳内，
而壳内构图对三个方案的影响完全不同（§6.2）。如果决定保留 `ui` 的全幅构图，
那 §3.6 应当同步改口径或登记进 §8「已知偏差」——**这属于设计层决定，不是本轮能替
产品负责人做的**。

### 6.2 壳内构图下的表现差异

| 方案 | 壳内（`contained`）表现 |
|---|---|
| A OpticFlow | ✅ 直接成立。它本来就是为壳内写的：一条斜穿右侧栏的玻璃光带，从左下进、被卡片压住、从右上出 |
| B Prism | ⚠️ 画布是一整块矩形，硬边会露出来。本轮给 `contained` 统一加了一层径向收边遮罩才压住；**但收边后 Prism 的特征（棱镜形状与色带）基本消失，只剩一片柔光** |
| C 融合 | ⚠️ 棱镜本体正好落在信息卡后面（桌面：主视觉区 513×397，卡片盖住 x 951–1271 / y 283–532，棱镜落在 (1151, 346)），只有色散扇从卡片右上露出来 |

### 6.3 动效生命周期

`DESIGN.md` §3.7 的硬要求（原文）：

> **性能与生命周期**：有明确的性能预算；离屏即停；页面隐藏即停；
> `prefers-reduced-motion: reduce` 下**当场停**（实时订阅，不是一次性读取）；
> 首屏动效不设手动控件：intro 后自动旋转约 5 秒即停（`data-mode="settled"`），
> 系统动效偏好仍可随时立即冻结。

| 方案 | 离屏 / 隐藏停机 | Reduced Motion 当场停 | 5 秒自动停 | 手动控件 |
|---|---|---|---|---|
| A OpticFlow | ✅ | ✅ | ❌ 无限循环 | ❌（multiagent 分支有「暂停动效」徽章，同样违规） |
| B Prism | ✅ | ✅ | ✅ `data-mode="settled"` | ✅ 无 |
| C 融合 | ✅ | ✅ | ❌ 继承 A | ❌ |

「停机后是否还在渲染」这一项在 §5 有实测读数。注意 A/C 的无限循环**不是 bug**，
是 Beams 引擎没有 settle 逻辑——要合规需要给引擎加一个 5 秒窗口，
并把 multiagent 分支那个手动徽章去掉。

补充一个代码级细节：`Prism.tsx` 里 `const busy = spinning || settling || introClock < 1 ||
(!reduce && s.noise > 0)`——只要 `noise > 0`，rAF 循环就永远不会停，哪怕画面已经静止。
Iris 的 `HeroPrism` 在 settle 时**同时**把 `timeScale` 与 `noise` 置 0
（`HeroPrism.tsx` 的 `noise={frozen ? 0 : …}`），所以 B 是**真的**停机，
§5 里实测 `draws/s = 0`。这个细节说明「视觉停了」和「GPU 停了」是两件事。

Beams 引擎则是另一种形状：它的 `paused` **只停状态推进，不直接停 rAF**。
rAF 循环要等 `settling` 条件全部落空才收尾：

```js
// beamsMount.ts
const settling =
  state.intro < 1 ||
  Math.abs((engaged ? 1 : 0) - state.reach) > 0.002 ||
  Math.abs(pointer.x - state.x) + Math.abs(pointer.y - state.y) > 0.3
```

其中 `state.reach`（指针参与度）在指针离开后以 1.8/s 的速率衰减，从 ≈1 掉到 0.002
需要 `ln(500)/1.8 ≈ 3.45 s`。实测完全对得上（§5 表）：

- **点完「暂停动效」后的头 ~3.5 s，GPU 仍在逐帧 draw**——「暂停」不等于「停机」；
- 指针移出画布并等衰减完成后，**draws/s 归 0**；
- 全新以暂停态打开（指针从未进入画布）时，`reach` 恒为 0，**intro 一结束就收尾**，
  draws/s = 0。

也就是说：**引擎本身能停机，只是「暂停」到「停机」之间有一段指针跟随的尾巴。**
如果 A/C 要满足 §3.7 的「5 秒自动停」，正确的做法是**到点直接停 rAF**
（而不是指望 `settling` 自己收敛），顺带把这段尾巴也去掉。

---

## 7. 建议

### 7.1 如果现在就选一版

**选 A（OpticFlow）**，理由按分量排序：

1. 它在 10 条判据里拿到的高分最多，而且**没有一条是「输」**；
2. 它的构图（斜穿光带）与 §3.6「光带被裁在壳里」天然一致，
   也就是说它同时能应付「壳内」和「全幅」两种口径，不用等构图定完再返工；
3. 它的渲染成本与 C 相同（同一个 Beams 循环、同样 `quality 0.75` / `dpr 1.5` /
   2160×1176 画布），而且实测两者的流畅度差距在 10% 量级（§5.3），不构成选型理由；
   且它已经在 multiagent 分支跑过。

### 7.2 如果要继续做 C（推荐路线）

C 的方向没错，错的是三处**收敛**问题，都不需要换渲染器、不需要第二个 GPU 循环：

| # | 问题 | 小改动方案 |
|---|---|---|
| C-1 | 色散扇冲出玻璃外壳（桌面右上角、手机右侧与底部） | 把扇长从 400 收到 ~240，棱镜沿入射线**左下移**约 60 svg 单位，并给 `.hero-fusion__optics` 的径向遮罩按断点重算中心与半径；手机端用竖构图并把扇角收到 ±8° |
| C-2 | Light 主题下棱镜读成线框 | 把面渐变从「乳白 0.52 → 淡蓝 0.1」改成带方向性的玻璃面（左侧暗、右侧亮），并把描边不透明度从 0.95 降到 ~0.55，让三角在亮底上读成**实心玻璃**而不是轮廓线 |
| C-3 | 动效不停机、且带手动控件 | 给 Beams 引擎加 `MOTION_WINDOW_MS = 5000` 的 settle（到点后**直接停 rAF** 并把 `data-mode` 置 `settled`），同时删掉 multiagent 分支的「暂停动效」徽章。**不要只把 `paused` 置 true**——那样只会停状态推进，rAF 还要再画约 3.5 s 等指针残差衰减（§6.3） |
| C-4 | 首屏帧率的大头在 SVG 叠层，不在 WebGL 场 | 想再要帧率时，改错地方会白费功夫 | 叠层用 `display:none` 实测可各涨约 16 fps（A 74.4→90.1、C 77.5→94.3，§5.3）；若确需提速，先减 `mix-blend-mode` 与大面积半透明渐变的层数 |

改完这三处，C 的预期表现是：Light 与 Dark 同一个主角（棱镜）、扇不出壳、
5 秒后安静下来。届时 C 会明显强于 A。

### 7.3 不建议的做法

- 不要为了「更像 Prism」把 C 改成第二套 Prism 渲染器叠加——那会同时踩 §3.6
  「不另起第二个 WebGL 循环」和性能预算。
- 不要因为 C 已经在视觉上「有戏」就跳过 §3.6 的构图决策：构图表现在 C 上
  的影响比渲染器本身更大。

---

## 8. 未解决问题与设计风险

| # | 风险 | 影响 | 处置建议 |
|---|---|---|---|
| R-1 | **§3.6 首屏构图口径与两条实现都不完全一致** | 选型基准不稳定；改构图可能推翻选型结论 | 产品负责人先定口径（见 §6.1）。若确认按 §3.6 执行，需另开一轮「回到壳内构图」的首页改造——**不是本轮范围** |
| R-2 | **A / C 的首屏动效无限循环**，且 multiagent 分支带手动「暂停动效」徽章 | 与 §3.7「5 秒自动停、不设手动控件」冲突 | 记入 `DESIGN.md` §8 待办或开 Issue；实现办法见 §7.2 C-3 |
| R-3 | **C 在 390 宽下扇与棱镜出框** | 移动端构图不成立 | 见 §7.2 C-1 |
| R-4 | **C 在 Light 下棱镜像线框** | 两套主题主角不一致 | 见 §7.2 C-2 |
| R-5 | **B（Prism）在壳内构图下不成立** | 如果 §3.6 走壳内，B 需要重做或放弃 | 记入 §8 |
| R-6 | **Prism 的公开源码分发风险**（MIT + Commons Clause v1.0） | 商业化或改成组件库时触发限制 | 沿用 2026-11-16 的风险接受结论；商业化前必须重评（§3.6） |
| R-7 | 本轮只在本机（一台 Windows 机器 + 一个 Chromium 版本）上测性能 | 跨设备负载数据缺失；低配设备降级路径只有代码契约与单元测试，没有真机帧率 | 若要冻结，建议补一轮真机（iOS Safari / 中端 Android）抽测 |
| R-8 | 亮暗切换的「闪屏」只做了**间接**验证（切换不新建 WebGL2 上下文、画布数量不变），没有做逐帧像素差分 | 无法排除切换瞬间的一帧闪白 | 若需要严格结论，补一次切换期间的逐帧截图序列 |
| R-9 | **性能读数受本机负载影响**：同一段代码在「跑完 60 次截图之后」与「空载」两种状态下差出约 20 fps（§5.3） | 绝对帧率不可外推到别的机器；三方案之间的差值（10% 量级）也小于本机的抖动 | 报告里所有帧率都标注了测量条件；选型结论不依赖帧率。若要定性能基线，需在**目标机型**上单独跑 `HERO_COMPARE_PERF_ONLY=1` |
| R-10 | Beams 引擎的 `paused` 不是「停 rAF」，指针跟随残差会让循环再画约 3.5 s（§6.3） | 若未来给 A / C 加「5 秒自动停」，只置 `paused` 达不到 §3.7 | 实现办法见 §7.2 C-3：**到点直接停 rAF**，不要依赖 `settling` 收敛 |

---

## 9. 复现命令

```bash
# 1) 对照台构建（含 dev-only 设计路由）
cd web
VITE_DESIGN_PREVIEW=true npx vite build
npx vite preview --port 4173 --strictPort

# 2) 原生 OpticFlow 构建（另一个分支，作为原生参考）
cd <feat/iris21-multiagent-integration 的 web>
npx vite build
npx vite preview --port 4174 --strictPort

# 3) 取证（真实 Chromium，headful）
cd <本分支的 web>
node scripts/evidence/hero-compare.mjs

# 可选环境变量
#   HERO_COMPARE_BASE（默认 http://localhost:4173）
#   HERO_OPTIC_BASE  （默认 http://localhost:4174）
#   E2E_CHROMIUM_PATH
#   HERO_COMPARE_PERF_ONLY=1（只重跑性能与降级读数；截图沿用上一轮，
#                            结果并回上一轮的 manifest.json）
```

产物：`target/iris-hero-comparison/manifest.json`（全部元数据 + 性能读数 + 复现命令）、
`docs/reviews/assets/iris-hero-comparison/manifest-summary.json`。

---

## 10. 截图绝对路径

下面全是本机绝对路径，直接双击就能打开。**建议按这个顺序看**：

1. `compare-bleed-light-desktop.png` 与 `compare-bleed-dark-desktop.png` —— 三版并排（`ui` 现行构图）
2. `compare-contained-light-desktop.png` 与 `compare-contained-dark-desktop.png` —— 三版并排（壳内构图）
3. `matrix-bleed-A-optic-desktop-light.png` / `-B-prism-` / `-C-fusion-` —— 单版大图
4. `matrix-bleed-C-fusion-phone-light.png` —— 手机上 C 的出框问题
5. `webgl-disabled-*` 与 `reduced-motion-*` —— 降级画面
6. `native-optic-9a6dbcb6-desktop-light.png` 与 `native-prism-ui-b805377f-desktop-light.png` —— 原生页面

要自己看活的：切到本分支后 `cd web && VITE_DESIGN_PREVIEW=true npx vite build && npx vite preview --port 4173 --strictPort`，
然后打开 `http://localhost:4173/design/hero-compare?variant=fusion`（`variant` 取 `optic|prism|fusion`，
`shell=contained` 切壳内构图）。这条路由**只在开发构建或显式设 `VITE_DESIGN_PREVIEW=true` 时存在**，
正式构建里没有。

**元数据**（目录 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison`）

- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\README.md`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\manifest-summary.json`

**三版对照拼图**（目录 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison`）

- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-all-contained-desktop.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-all-desktop.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-bleed-dark-desktop.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-bleed-dark-phone.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-bleed-light-desktop.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-bleed-light-phone.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-contained-dark-desktop.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-contained-dark-phone.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-contained-light-desktop.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-contained-light-phone.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\compare-native-desktop.png`

**核心对照（桌面 · 全幅构图）**（目录 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison`）

- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-bleed-A-optic-desktop-dark.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-bleed-A-optic-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-bleed-B-prism-desktop-dark.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-bleed-B-prism-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-bleed-C-fusion-desktop-dark.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-bleed-C-fusion-desktop-light.png`

**核心对照（桌面 · 壳内构图）**（目录 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison`）

- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-contained-A-optic-desktop-dark.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-contained-A-optic-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-contained-B-prism-desktop-dark.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-contained-B-prism-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-contained-C-fusion-desktop-dark.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\matrix-contained-C-fusion-desktop-light.png`

**原生页面参考**（目录 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison`）

- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\native-optic-9a6dbcb6-desktop-dark.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\native-optic-9a6dbcb6-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\native-prism-ui-b805377f-desktop-dark.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\native-prism-ui-b805377f-desktop-light.png`

**降级与 Reduced Motion**（目录 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison`）

- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\reduced-motion-A-optic-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\reduced-motion-B-prism-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\reduced-motion-C-fusion-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\webgl-disabled-A-optic-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\webgl-disabled-B-prism-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\webgl-disabled-C-fusion-desktop-light.png`

**冻结帧**（目录 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison`）

- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\settled-A-optic-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\settled-B-prism-desktop-light.png`
- `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\docs\reviews\assets\iris-hero-comparison\settled-C-fusion-desktop-light.png`

---

## 11. 产物清单

**入库**（`docs/reviews/assets/iris-hero-comparison/`，可持续保留）

- `README.md`（2 KB）
- `compare-all-contained-desktop.png`（137 KB）
- `compare-all-desktop.png`（279 KB）
- `compare-bleed-dark-desktop.png`（492 KB）
- `compare-bleed-dark-phone.png`（1228 KB）
- `compare-bleed-light-desktop.png`（467 KB）
- `compare-bleed-light-phone.png`（1175 KB）
- `compare-contained-dark-desktop.png`（186 KB）
- `compare-contained-dark-phone.png`（599 KB）
- `compare-contained-light-desktop.png`（206 KB）
- `compare-contained-light-phone.png`（644 KB）
- `compare-native-desktop.png`（265 KB）
- `manifest-summary.json`（13 KB）
- `matrix-bleed-A-optic-desktop-dark.png`（821 KB）
- `matrix-bleed-A-optic-desktop-light.png`（757 KB）
- `matrix-bleed-B-prism-desktop-dark.png`（928 KB）
- `matrix-bleed-B-prism-desktop-light.png`（856 KB）
- `matrix-bleed-C-fusion-desktop-dark.png`（756 KB）
- `matrix-bleed-C-fusion-desktop-light.png`（757 KB）
- `matrix-contained-A-optic-desktop-dark.png`（267 KB）
- `matrix-contained-A-optic-desktop-light.png`（279 KB）
- `matrix-contained-B-prism-desktop-dark.png`（278 KB）
- `matrix-contained-B-prism-desktop-light.png`（298 KB）
- `matrix-contained-C-fusion-desktop-dark.png`（255 KB）
- `matrix-contained-C-fusion-desktop-light.png`（285 KB）
- `native-optic-9a6dbcb6-desktop-dark.png`（908 KB）
- `native-optic-9a6dbcb6-desktop-light.png`（332 KB）
- `native-prism-ui-b805377f-desktop-dark.png`（1481 KB）
- `native-prism-ui-b805377f-desktop-light.png`（856 KB）
- `reduced-motion-A-optic-desktop-light.png`（764 KB）
- `reduced-motion-B-prism-desktop-light.png`（599 KB）
- `reduced-motion-C-fusion-desktop-light.png`（765 KB）
- `settled-A-optic-desktop-light.png`（764 KB）
- `settled-B-prism-desktop-light.png`（599 KB）
- `settled-C-fusion-desktop-light.png`（765 KB）
- `webgl-disabled-A-optic-desktop-light.png`（447 KB）
- `webgl-disabled-B-prism-desktop-light.png`（578 KB）
- `webgl-disabled-C-fusion-desktop-light.png`（729 KB）

**本地全量**（`D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\target\iris-hero-comparison`，已被 `.gitignore` 忽略）

- 截图 63 张（矩阵 48 + 原生参考 6 + 冻结帧 3 + Reduced Motion 3 + WebGL 降级 3）
- `manifest.json`：每张截图的 commit / 浏览器版本 / 分辨率 / 主题 / 方案 / 构图 / 动效状态 / 取帧时点 / 时间戳 / SHA-256，以及性能与降级读数
- `manifest-summary.json`：入库版的摘要
- 录屏 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\target\iris-hero-comparison\motion-A-optic-desktop-light.webm`（5 秒 / 方案）
- 录屏 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\target\iris-hero-comparison\motion-B-prism-desktop-light.webm`（5 秒 / 方案）
- 录屏 `D:\Work\code\eye-diagnosis\.worktrees\r5-joint-v2\target\iris-hero-comparison\motion-C-fusion-desktop-light.webm`（5 秒 / 方案）

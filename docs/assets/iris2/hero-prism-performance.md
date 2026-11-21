# 首屏 Prism · 视觉与性能记录（2026-11-16）

> 这是**本机真实浏览器**的采集记录，不是 CI 门禁，也不是跨设备的性能承诺。
> 生命周期契约（StrictMode、上下文丢失、离屏/后台暂停、reduced-motion 切换、
> 5 秒自动停帧）由 `web/src/components/brand/Prism.test.tsx` 与
> `HeroPrism.test.tsx` 覆盖；本文只回答两件事：首屏实际长什么样、
> **动效窗口内**掉不掉帧。

## 截图

| 主题 | 文件 |
|---|---|
| Light | `docs/assets/iris2/hero-prism-1440-light.jpg` |
| Dark | `docs/assets/iris2/hero-prism-1440-dark.jpg` |

- 视口 1440×900 @1x，生产构建（`npm run build` + `vite preview`），headful Chromium。
- 截图在挂载后约 4.5s 拍摄：intro 已结束、仍在 5s 动效窗口内，不是冻结后的静态帧。
- 浏览器：Playwright `chromium-1234`（`chrome-win64`），未使用 SwiftShader。

## 环境

| 项 | 值 |
|---|---|
| GPU / 渲染器 | ANGLE (AMD, AMD Radeon(TM) Graphics, Direct3D11 vs_5_0 ps_5_0) |
| 视口 / DPR | 1440×900 / 1 |
| Canvas 缓冲区 | 1071×588（CSS 1428×784，分辨率系数 0.75） |
| 逻辑核心 | 16 |
| JS 堆 | ≈ 5.7–5.9 MB |
| WebGL2 上下文 | 1 |

## 方法（本轮修正）

- 首屏动效现在**满 5 秒自动停在当前相位**，所以采样必须落在
  intro 之后、冻结之前：挂载后约 **1.5–4.5s**。
- 该窗口内跑 **3 个 1 秒采样**，取中位数；不把冻结后的静态帧算进 FPS。
- `dropped` 指单帧 > 20ms 的帧数；`p95` 为帧间隔 95 分位。
- 长任务用 `PerformanceObserver({ type: "longtask" })`，**不取 buffered**，
  只统计采样窗口。
- 通过改写 `HTMLCanvasElement.prototype.getContext` 统计「首次拿到 webgl2 的画布数」，
  重复 `getContext` 不重复计数。
- 采样结束后再等 1.2s，断言 `.hero-prism[data-mode]` 已变为 `settled`。

> 旧口径（3×3 秒）会跨过 5 秒冻结点，把静态帧混进 FPS，已废弃。

## 结果

| 主题 | FPS 中位数（范围） | p95 帧间隔 | 掉帧 / 采样帧 | 窗口内长任务 |
|---|---|---|---|---|
| Light | **55.0**（52.6–56.8） | 36.4 ms | 60 / 167 | 0 |
| Dark | **45.7**（45.1–47.3） | 36.4 ms | 81 / 140 | 0 |

亮/暗切换（同页点击主题钮，冻结之后）：

- WebGL2 上下文数保持 **1**，没有重建；
- `.hero-prism[data-theme]` 变为 `dark`，`html.dark` 生效。

自动停帧（真实浏览器）：

- 采样结束后观察到 `data-mode="settled"`，分别在 `performance.now()` ≈ 8115ms / 7356ms
  （含导航与加载时间）；冻结点由挂载起算 5s，与单测一致。

## 解读

- 集成显卡上动效窗口内中位数 **46–55 fps**，p95 36.4ms，**没有长任务**；
  掉帧是 2–3 帧的偶发尖峰，没有持续劣化。
- 暗色主题中位数低约 9 fps；同一着色器成本下，更像暗色画布叠加与桌面合成
  带来的波动，而不是引擎重建或主线程阻塞。
- 动效 5 秒后自动停止，稳态不再持续占用 GPU；画面保留最后一帧，鼠标倾斜仍可用。

## 复现

```bash
cd web
npm run build
npm run preview -- --port 4173 --strictPort
node scripts/evidence/hero-prism.mjs
```

可用 `PRISM_BASE` 指向别的地址，`E2E_CHROMIUM_PATH` 指定浏览器。
脚本会重写两张截图与 `hero-prism-performance.json`。

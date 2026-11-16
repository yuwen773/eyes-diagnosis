# 首屏 Prism · 视觉与性能记录（2026-11-16）

> 这是**本机真实浏览器**的采集记录，不是 CI 门禁，也不是跨设备的性能承诺。
> 生命周期契约（StrictMode、上下文丢失、离屏/后台暂停、reduced-motion 切换）
> 由 `web/src/components/brand/Prism.test.tsx` 与 `HeroPrism.test.tsx` 覆盖；
> 本文只回答两件事：首屏实际长什么样、稳态运行时掉不掉帧。

## 截图

| 主题 | 文件 |
|---|---|
| Light | `docs/assets/iris2/hero-prism-1440-light.jpg` |
| Dark | `docs/assets/iris2/hero-prism-1440-dark.jpg` |

- 视口 1440×900 @1x，生产构建（`npm run build` + `vite preview`），headful Chromium。
- 等 intro（1.4s）结束后再截；画面处于常规旋转相位，不是降级静态图。
- 浏览器：Playwright `chromium-1234`（`chrome-win64`），未使用 SwiftShader。

## 环境

| 项 | 值 |
|---|---|
| GPU / 渲染器 | ANGLE (AMD, AMD Radeon(TM) Graphics, Direct3D11 vs_5_0 ps_5_0) |
| 视口 / DPR | 1440×900 / 1 |
| Canvas 缓冲区 | 1071×588（CSS 1428×784，分辨率系数 0.75） |
| 逻辑核心 | 16 |
| JS 堆 | ≈ 5.9 MB |
| WebGL2 上下文 | 1 |

## 方法

- 每个主题跑 **3 个 3 秒窗口**，取中位数；采样前先等 intro 结束。
- `dropped` 指单帧 > 20ms 的帧数；`p95` 为帧间隔 95 分位。
- 长任务用 `PerformanceObserver({ type: "longtask" })`，**不取 buffered**，
  只统计稳态窗口，不含首屏加载。
- 通过改写 `HTMLCanvasElement.prototype.getContext` 统计「首次拿到 webgl2 的画布数」，
  重复 `getContext` 不重复计数。

## 结果

| 主题 | FPS 中位数（范围） | p95 帧间隔 | 掉帧 / 采样帧 | 稳态长任务 |
|---|---|---|---|---|
| Light | **52.9**（51.3–54.8） | 31.9 ms | 149 / 478 | 0 |
| Dark | **48.3**（41.2–50.6） | 36.4 ms | 206 / 421 | 0 |

亮/暗切换（同页点击主题钮）：

- WebGL2 上下文数保持 **1**，没有重建；
- `.hero-prism[data-theme]` 变为 `dark`，`html.dark` 生效，`data-mode` 仍为 `live`。

## 解读

- 集成显卡上稳态约 **48–53 fps**，p95 32–36ms，**没有长任务**；掉帧集中在
  2–3 帧的偶发尖峰，没有持续劣化。
- 暗色主题中位数低约 5 fps，3 次采样方差也更大；在同一着色器成本下，
  更像是暗色画布叠加与桌面合成带来的波动，而不是引擎重建或主线程阻塞。
- 该画面是纯装饰层，`prefers-reduced-motion: reduce` 下会冻结在当前帧；
  掉帧不阻塞任何判读交互。

## 复现

```bash
cd web
npm run build
npm run preview -- --port 4173 --strictPort
node scripts/evidence/hero-prism.mjs
```

可用 `PRISM_BASE` 指向别的地址，`E2E_CHROMIUM_PATH` 指定浏览器。
脚本会重写两张截图与 `hero-prism-performance.json`。

# 第三方来源与许可

本目录下的 `beamsEngine.ts` 与 `beamsMount.ts` 是**上游第三方组件的 vendor 副本**，
不是本项目原创。其余文件（`OpticFlow.tsx`、`LandingHero.tsx`、`BrandPanel.tsx`、
`OpticFlow.test.tsx`、`beamsMount.test.ts`）由本项目编写。

---

## React Bits · Beams

| 项 | 内容 |
|----|------|
| 上游 | https://github.com/DavidHDev/react-bits |
| 源文件 | `src/content/Backgrounds/Beams/Beams.jsx` |
| **固定 commit** | **`ed33ebe4acfe29e60fb759bcccc70a138ce2dcef`**（2026-11-08，"Fix/responsive preview flicker (#1109)"） |
| 取用时间 | 2026-11-12，取 `main` 当时该文件的最新一次提交；下面「校验」一节有比对证据 |
| 作者 | David Haz |
| 许可 | MIT License **+ Commons Clause License Condition v1.0**（Copyright (c) 2026 David Haz） |
| 署名位置 | 本文件 + `beamsEngine.ts` 文件头，两处都保留 |

> 上游没有给这个组件打版本标签，所以**只认 commit SHA**。换了 SHA 就要重做下面的校验。

### 校验：与固定 commit 的逐字比对

2026-11-12 重新拉取 `ed33ebe4acfe29e60fb759bcccc70a138ce2dcef` 下的 `Beams.jsx`，
把它与本仓库 `beamsEngine.ts` 里的三个模板字符串（顶点着色器 / FIELD / COMPOSITE）
逐字比对：

| 着色器 | 上游 SHA-256 前 12 位 | 本仓库 | 结论 |
|---|---|---|---|
| 顶点 | `254cf7532230` | **同值** | 逐字一致 |
| FIELD | `ce0437306e9d` | 已改动 | 见下方「相对上游的改动」 |
| COMPOSITE | `39bf1cf8ca1a` | 已改动 | 同上 |

> ⚠️ **2026-11-12（R2-01）起，FIELD 与 COMPOSITE 不再与上游逐字一致**。
> 原因是首屏要做「光学玻璃带」而不是「一团发光」：需要给带体一条可辨认的边缘。
> 顶点着色器仍逐字一致。

### 相对上游的改动：FIELD / COMPOSITE 的带边高光（R2-01，2026-11-12）

| 位置 | 改动 | 理由 |
|---|---|---|
| `FIELD.main()` | 新增 `edgeDist = min(u, 1-u)` 与 `rim = 1 - smoothstep(0, 0.045, edgeDist)`，输出改为 `vec4(value.x, value.y, min(hot, 6.0), rim)`（上游 `.a` 恒为 `1.0`） | 上游的带子只是「一团发光」，没有边界；`rim` 表示距最近带边的归一化距离，合成阶段据此画镜面反光 |
| `COMPOSITE.main()` | 读取 `.a` 作为 `rim`；亮色分支 `alpha *= 1.0 - rim * 0.55`；暗色分支在写入前 `color += rim * mix(uColor, white, 0.55) * 0.42 * mask` | 亮环境里玻璃读作「透明体 + 亮边」（边缘透出画布 = 反光），暗环境里给带体厚度与前后关系 |

其余语句——噪声、lobe、ACES、泛光采样顺序、feather、抖动——与上游一致。

### 改动范围（相对上游）

| 文件 | 改动 | 原因 |
|------|------|------|
| `beamsEngine.ts` | 删去 React 组件外壳与其自带 CSS；补 TypeScript 类型标注；**顶点着色器逐字保留**；FIELD / COMPOSITE 增加带边高光（见上一节） | 让引擎能脱离 React 使用、纳入类型检查，并支持首屏的「光学玻璃带」目标 |
| `beamsMount.ts` | 把上游写在 `useEffect` 里的挂载逻辑抽成普通函数 `mountBeams()`；补 `webglcontextlost` 处理、`prefers-reduced-motion` 的运行时订阅、`dispose()` 幂等与「不主动丢上下文」 | 支持「WebGL2 不可用 / 上下文丢失 / 减少动效 / StrictMode 重复挂载」四条生命周期路径 |

上游原始渲染流程（场渲染 → mipmap 泛光 → 合成、鼠标交互、intro 动画、
可见性监听、ResizeObserver）保持不变。

### 许可原文（固定 commit 下的 `LICENSE.md`，正文照录）

> **不是逐字等同**：为便于阅读，下文对关键限制加了 Markdown 粗体强调。
> 文字与语义未改，但字面上与上游文件不同；需要逐字比对时以上游仓库的
> `LICENSE.md` 为准。

```text
MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**

The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**

What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**

## No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 许可判断（**待产品负责人确认，不是结论**）

这段话允许的：**把它作为应用 / 网站 / 产品的一部分使用，包含商业用途**，允许修改。
这段话限制的：**不得销售、再许可、再分发「组件本身」——单独、打包、或以移植版的形式。**

本项目符合的部分：

- 它只作为 Iris 内部产品的一个首屏背景使用，不单独售卖、不再许可；
- 版权与许可声明在两处保留（本文件 + 源文件头）。

**需要确认的一点**：本仓库是**公开仓库**，`beamsEngine.ts` 是一份「去掉 React 外壳的
移植版」，并且随仓库公开分发。严格按字面，"redistribute the components themselves …
as a ported version" 覆盖这种情况。合规的做法有三条路，按代价从低到高：

1. **保持现状 + 记录在案**：由负责人书面确认「内部产品、公开仓库、非商业分发」这一解释；
2. **仓库里不放 vendored 副本**：把 `beamsEngine.ts` / `beamsMount.ts` 移到运行时私有依赖
   或构建期注入，开源仓库只留接口与说明；
3. **换成自研或更宽松许可的实现**：代价最大，且本轮明确禁止新增背景渲染器。

本 PR 只做第 1 条的「记录在案」，不擅自替负责人做合规判断。

---

## 字体

- **Manrope**（拉丁品牌字体）经 `@fontsource-variable/manrope` 引入，
  SIL Open Font License 1.1，包内已含许可证。
- **Noto Sans SC / Noto Serif SC / IBM Plex Mono** 沿用项目既有依赖，
  均为 SIL Open Font License 1.1。

## 未引入的依赖

本轮**没有**引入 Three.js / React Three Fiber / `@react-three/*`：
Beams 上游本身是裸 WebGL2 实现，无需三维库。

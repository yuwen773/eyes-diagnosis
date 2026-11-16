# 第三方来源与许可

本目录下的 `Prism.tsx` 与 `Prism.css` 是**上游第三方组件的 vendor 副本**，
不是本项目原创。其余文件（`HeroPrism.tsx`、`HeroPrism.test.tsx`、`LandingHero.tsx`、
`BrandPanel.tsx`、`BrandFooter.tsx`、`notices.test.ts`）由本项目编写。
品牌顶栏的虹膜标与字标已随 R2.5-01 移到 `src/components/shell/Wordmark.tsx`，同样是本项目编写。

---

## React Bits · Prism

| 项 | 内容 |
|----|------|
| 上游 | https://github.com/DavidHDev/react-bits |
| 源文件 | `src/content/Backgrounds/Prism/Prism.jsx` + `Prism.css`（JavaScript + CSS 版本） |
| 取用时间 | 2026-11-16，由产品负责人提供的组件源码 |
| 上游版本 | **无版本标签 / 固定 commit**；本仓库以 `Prism.tsx` 的移植版为准 |
| 作者 | David Haz |
| 许可 | MIT License **+ Commons Clause License Condition v1.0**（Copyright (c) 2026 David Haz） |
| 署名位置 | 本文件 + `Prism.tsx` 文件头，两处都保留 |

### 相对上游的改动

| 文件 | 改动 | 原因 |
|------|------|------|
| `Prism.tsx` | 补 TypeScript 类型标注，纳入 `tsc -b` 门禁 | 与项目其余代码同一套类型检查 |
| `Prism.tsx` | `prefers-reduced-motion` 从「挂载时读一次」改为**实时订阅** | 用户运行中切换系统动效偏好要当场生效 |
| `Prism.tsx` | 新增 `onUnavailable`：WebGL2 不可用、着色器编译/链接失败、`webglcontextlost` 时通知调用方 | 首屏必须有静态降级，不能留一块空白画布 |
| `Prism.tsx` | cleanup 不在 StrictMode 假卸载时无条件 `loseContext()` | 假卸载会立刻复用同一张 canvas，提前丢上下文会把新上下文一起弄丢 |
| `Prism.tsx` | 删除上游的 `settingsRef.current = settings` 渲染期赋值，改到 effect 里 | 避免 React Hooks 的 refs-during-render 规则 |

着色器与渲染流程（场渲染、色带、intro、鼠标倾斜、可见性监听、ResizeObserver）与上游保持一致。

### 许可原文（正文照录）

> **不是逐字等同**：为便于阅读，下文对关键限制加了 Markdown 粗体强调。
> 文字与语义未改，但字面上与上游文件不同；需要逐字比对时以上游仓库的
> `LICENSE.md` 为准。

```text
MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software **as part of an application, website, or product**, subject to the following conditions:

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
- 版权与许可声明在两处保留（本文件 + `Prism.tsx` 文件头）。

**需要确认的一点**：本仓库是**公开仓库**，`Prism.tsx` 是一份「补类型 + 改生命周期的
移植版」，并且随仓库公开分发。严格按字面，"redistribute the components themselves …
as a ported version" 覆盖这种情况。合规的做法有三条路，按代价从低到高：

1. **保持现状 + 记录在案**：由负责人书面确认「内部产品、公开仓库、非商业分发」这一解释；
2. **仓库里不放 vendored 副本**：把 `Prism.tsx` / `Prism.css` 移到运行时私有依赖
   或构建期注入，开源仓库只留接口与说明；
3. **换成自研或更宽松许可的实现**。

本文件只做第 1 条的「记录在案」，不擅自替负责人做合规判断。

---

## 字体

- **Manrope**（拉丁品牌字体）经 `@fontsource-variable/manrope` 引入，
  SIL Open Font License 1.1，包内已含许可证。
- **Noto Sans SC / Noto Serif SC / IBM Plex Mono** 沿用项目既有依赖，
  均为 SIL Open Font License 1.1。

## 未引入的依赖

本轮**没有**引入 Three.js / React Three Fiber / `@react-three/*`：
Prism 上游本身是裸 WebGL2 实现，无需三维库。

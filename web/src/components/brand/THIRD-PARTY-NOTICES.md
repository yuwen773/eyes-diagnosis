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
to use, copy, modify, merge, publish, distribute the Software **as part of an application, website, or product**, subject to the following conditions:

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

### 分发授权核对（2026-11-16）

**已核对上游原文**：`https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md`
（HTTP 200，2026-11-16）；README 的 License 段落写的是
"MIT + Commons Clause, free for personal and commercial use"。

允许的：把软件**作为应用 / 网站 / 产品的一部分**使用、复制、修改、合并、发布与分发，
包含商业用途；版权与许可声明随附。

限制的（Commons Clause）：**不得销售、再许可、再分发「组件本身」——单独、打包、
或以移植版的形式。**

**与本仓库的关系**：`Prism.tsx` 是补类型并改生命周期的**移植版**，本仓库是
**公开仓库**（GitHub `yuwen773/eyes-diagnosis`，PUBLIC）。严格按字面，
「公开仓库里的移植版源码」落在 "redistribute … as a ported version" 的限制范围内；
MIT 的 "as part of an application" 是否覆盖公开源码分发，原文没有给出明确许可。

### 分发授权结论（2026-11-16，负责人确认）

产品负责人于 2026-11-16 确认按以下解释**保留现状**：

- 本仓库是公开的**非商业演示 / 学术项目**（Iris 眼底判读），Prism 只作为应用
  首屏背景的一部分使用；
- 不销售、不再许可、不把 Prism 组件本身（含移植版）作为独立组件、模板或
  付费产品分发；
- 版权与许可声明保留在本文件与 `Prism.tsx` 文件头。

这是项目方对 Commons Clause 公开源码分发解释的**风险接受**，不是上游的书面授权。
若后续项目商业化、改为组件库，或上游提出异议，应重新评估；必要时改为私有依赖
或自研实现。

---

## React Bits · R3 用户端体验重设计（2026-11-17）

R3 的 Phase 1（Agent 工作区）与 Phase 2（Journal 资讯体验）**参考**了 React Bits 的
五种交互形态：Prompt Bar、Thought Line、Lattice Loader、Animated Content、
Glare Hover。

**这五种交互全部是本仓库独立实现的**：没有复制上游源码，没有引入上游依赖，
`package.json` 没有因此多出任何一个包。上游许可（MIT + Commons Clause v1.0，
见上节照录；2026-11-17 复核 `LICENSE.md` 仍为 "MIT + Commons Clause License
Condition v1.0"，`Copyright (c) 2026 David Haz`）允许把软件作为应用的一部分使用与
修改，但 Commons Clause 明确禁止
**销售、再许可、再分发组件本身——单独、打包、或以移植版的形式**。本仓库是公开
仓库，把上游组件源码搬进来正落在「移植版再分发」这一条上；**「免费使用」不等于
「可以抄源码」**。因此这里走的是「读懂交互意图，自己写一份」的路线：自研实现不
构成 `redistribute … the component`，该限制不触发。

上游无 tag，参考阅读时的 `main` HEAD 为
`d01aa914dcbe76da8b2923ebf871b5c8b1066e4c`（2026-11-16）；对应文件为
`src/ts-default/Micro/{PromptBar,ThoughtLine,LatticeLoader}/` 与
`src/ts-default/Animations/{AnimatedContent,GlareHover}/`——**仅阅读，未复制**。
上游这几个组件自身的依赖是 `motion`、`@hugeicons/react`、
`@hugeicons/core-free-icons`（Prompt Bar、Thought Line）与 `gsap`（Animated
Content），本仓库一个都没有引入。

| 交互 | 上游做法 | 本仓库实现 | 文件 |
|------|---------|-----------|------|
| Prompt Bar | 自带输入与附件状态；`motion` + `@hugeicons` + 2D canvas 火花 | 无状态摆件 `PromptBar`，状态仍在 `ChatInput`；多行输入、Enter/Shift+Enter、IME 保护、附件增删、草稿存取、发送/停止全在原组件 | `web/src/components/agent/PromptBar.tsx` |
| Thought Line | DOM + CSS + `motion` 动画的执行行 | 纯 CSS 状态行；数据来自 `buildThread` 的**纯派生**，不额外维护一份状态机 | `web/src/components/agent/ThoughtLine.tsx` |
| Lattice Loader | 纯 DOM + CSS 点阵 | 纯 CSS 点阵；屏外 / 后台 / 减弱动效下不启动 | `web/src/components/agent/LatticeLoader.tsx` |
| Animated Content | `gsap` + ScrollTrigger 滚动触发 | 复用本仓库既有 `.reveal → .is-in` 基元与 `useRevealScan`（CSS transition，无 GSAP） | `web/src/lib/useInView.ts` |
| Glare Hover | 纯 CSS 效果 | 一层 CSS 径向渐变跟随指针（位置写进 `--gx` / `--gy`，不触发 React 重渲染）；触屏与减弱动效下不生效 | `web/src/components/news/GlareImage.tsx` |

**没有引入的东西**：Motion、GSAP、Three.js / React Three Fiber、`@react-three/*`、
Hugeicons。图标一律用既有的 `lucide-react` 静态命名导入。

---

## 字体

- **Manrope**（拉丁品牌字体）经 `@fontsource-variable/manrope` 引入，
  SIL Open Font License 1.1，包内已含许可证。
- **Dancing Script**（品牌点缀字体，仅用于 wordmark 拉丁品名）经
  `@fontsource/dancing-script` 引入，SIL Open Font License 1.1。
  Copyright (c) 2010 Pablo Impallari, Igino Marini；Reserved Font Name: Dancing Script。
  来源：https://www.fontsquirrel.com/fonts/dancing-script-ot
- **Noto Sans SC / Noto Serif SC / IBM Plex Mono** 沿用项目既有依赖，
  均为 SIL Open Font License 1.1。

## 工具库

- **NProgress**（顶部路由 / API 进度条）MIT License，版权所有 (c) 2014 Rico Sta. Cruz。

## 未引入的依赖

本轮**没有**引入 Three.js / React Three Fiber / `@react-three/*`：
Prism 上游本身是裸 WebGL2 实现，无需三维库。

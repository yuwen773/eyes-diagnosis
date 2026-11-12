# 第三方来源与许可

本目录下的 `beamsEngine.ts` 与 `beamsMount.ts` 是**上游第三方组件的 vendor 副本**，
不是本项目原创。其余文件（`OpticFlow.tsx`、`LandingHero.tsx`、`BrandPanel.tsx`）
由本项目编写。

---

## React Bits · Beams

| 项 | 内容 |
|----|------|
| 上游 | https://github.com/DavidHDev/react-bits — `src/content/Backgrounds/Beams/Beams.jsx` |
| 取用分支 / 时间 | `main` 分支，2026-11-12 取用 |
| 版本 | 未发布版本号，以取用当日的 `main` 为准（上游未给该组件打版本标签） |
| 作者 | David Haz |
| 许可 | MIT License **+ Commons Clause v1.0**（见下） |
| 引用方式 | 本仓库已在本文件与源文件头部同时标注来源与改动范围 |

### 许可要点

上游 `LICENSE.md` 对本组件采用 **MIT + Commons Clause v1.0** 双许可：

- MIT 部分允许使用、复制、修改、合并、发布、分发、再许可与销售；
- **Commons Clause v1.0 附加限制**：不得在**未经上游书面许可**的情况下，
  以「销售该组件本身」或「使该组件本身成为用户产品的竞争优势」的方式
  对外分发本组件；
- 附带「不得移除或混淆作者署名」的署名要求。

对本仓库的实际影响：

1. 本项目是**内部产品**，不把 Beams 当作可售卖的独立组件对外分发，
   不触碰 Commons Clause 的限制条款；
2. 上游要求保留署名——已在 `beamsEngine.ts` 文件头与本文件中各保留一份；
3. 本项目**未改动上游的着色器算法与渲染逻辑**，只做了工程化适配。

### 改动范围（相对上游）

| 文件 | 改动 | 原因 |
|------|------|------|
| `beamsEngine.ts` | 删去 React 组件外壳与其自带 CSS；补 TypeScript 类型标注；着色器源码（`QUAD_VERTEX` / `FIELD` / `COMPOSITE`）逐字保留 | 让引擎能脱离 React 使用，并纳入仓库的类型检查 |
| `beamsMount.ts` | 把上游写在 `useEffect` 里的挂载逻辑抽成普通函数 `mountBeams()`；新增 `webglcontextlost` 监听与 `onContextLost` 回调 | 支持「WebGL2 不可用 / 上下文丢失 / 离屏暂停」三条降级路径 |

上游原始渲染流程（场渲染 → mipmap 泛光 → 合成、鼠标交互、intro 动画、
可见性监听、ResizeObserver）保持不变。

### 字体

- **Manrope**（拉丁品牌字体）经 `@fontsource-variable/manrope` 引入，
  SIL Open Font License 1.1，包内已含许可证。
- **Noto Sans SC / Noto Serif SC / IBM Plex Mono** 沿用项目既有依赖，
  均为 SIL Open Font License 1.1。

### 未引入的依赖

本轮**没有**引入 Three.js / React Three Fiber / `@react-three/*`：
Beams 上游本身是裸 WebGL2 实现，无需三维库。

# R2.5-02 首页 Hero 之后 · 视觉证据

2026-11-13 摄于 R2.5 工作树（`localhost:5175`，真实后端代理），Chromium 1234 / SwiftShader。
所有截图都是**真实页面渲染**，不是设计稿。

## 文件

| 文件 | 说明 |
|---|---|
| `light-{specimen,how,record,agent,start}-1440.jpg` | Light 主题逐区块（1440 宽） |
| `dark-{specimen,how,record,agent,start}-1440.jpg` | Dark 主题逐区块 |
| `light-bounds-1440.jpg` / `dark-bounds-1440.jpg` | 责任边界（深海蓝实体面，等 reveal 动画结束后截取） |
| `{light,dark}-{390,768,1440,1920}-fold.jpg` | 四档宽度的首屏 |
| `{light,dark}-{390,768,1440,1920}-full.jpg` | 四档宽度的整页 |
| `{light,dark}-{how,record,agent,start}-390.jpg` | 390 下 Hero 之后的关键区块 |
| `{light,dark}-anchor-how.jpg` | 从页脚点「判读流程」锚点后的落点（标题未被吸顶顶栏遮住） |

## 实测

- 顶栏高度：品牌场景 70px（`--nav-h` 64px + 品牌内边距）；锚点落点留白 96.6px。
- 390 / 768 / 1440 / 1920 均无横向滚动（`scrollWidth === innerWidth`）。
- 整页高度：390 → 11225px，768 → 9509px，1440 → 8400px（Light/Dark 一致）。
- 两轮截图与 `typecheck` / `lint` / `vitest`（302 passing）/ `vite build` 过程中 **0 console error**。

## 读图注意

- 元素级截图里若出现一条横贯画面的顶栏，是 Playwright 对 sticky 顶栏截图时的合成结果，
  不是页面叠层缺陷；真实滚动下顶栏始终吸在视口顶端。
- `reveal` 入场动画约 760ms，逐区块截图均等待动画结束；责任边界两图单独等待 2.6s，
  避免截到半透明中间帧。

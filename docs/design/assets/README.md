# docs/design/assets/ · Iris 2.0 视觉参考资产

本目录只放 **Iris 自有资产**。第三方概念稿（Dribbble / Behance / V7 Darwin 等）
**只以链接形式**记录在 `../IRIS_2_DESIGN_REFERENCE_BRIEF.md` §1 与
`../../../DESIGN.md` 附录 B，**不复制其截图或图标进仓库**。

| 文件 | 是什么 | 不是什么 |
|---|---|---|
| `optic-flow-v4-light.png` | Iris Optic Flow **V4 概念稿**（浅色） | 不是产品截图，也不是实时渲染的截图 |
| `optic-flow-v4-dark.png` | 同上，暗色 | 同上 |
| `optic-flow-v4.html` | V4 概念稿的可交互源文件（自包含 HTML + 内联 SVG/CSS） | **不是**线上实现，也不引 React Bits |

**两点必须说清楚**

1. V4 概念稿是 **Hybrid SVG 概念**（文件页脚自己写着
   `HYBRID SVG CONCEPT, NOT LIVE REACT BITS`）。
   线上首屏跑的是 **vendored React Bits Beams（裸 WebGL2）**，
   见 `web/src/components/brand/OpticFlow.tsx` 与
   `web/src/components/brand/THIRD-PARTY-NOTICES.md`。
   **不要把概念稿说成"实时 WebGL / 3D"。**
2. 概念稿里的示意内容（如 "INTELLIGENCE LAYER" 卡片）**不是产品能力**。
   产品界面上的能力描述必须对应真实后端能力，未上线的写"规划中"。

**接入许可**：Beams 是 vendored 代码，许可为 MIT + Commons Clause v1.0，
固定上游 commit 与许可原文见 `web/src/components/brand/THIRD-PARTY-NOTICES.md`。
换 commit 必须重做逐字比对。

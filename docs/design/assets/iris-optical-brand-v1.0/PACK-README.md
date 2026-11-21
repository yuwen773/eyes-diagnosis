# Iris · Optical Iris PNG Brand Pack (v1.0)

> **历史资料 · 非有效接入说明（2026-11-16 起）**
>
> 本文档是品牌包 v1.0 的原始说明，仅用于追溯设计来源。其中的目录结构
> （`png/icon/`、`png/mono/` 等）、文件路径与尺寸口径**不代表本仓库实现**；
> 实际接入以同目录 `INTEGRATION.md` 为准。
>
> 两处已被项目决策取代：
> 1. 管理端不再使用 `iris-optical-admin-purple-1024.png`，改用从彩色母版派生的单色版；
> 2. 单色版不再是「轻量化几何近似、移除中心暗色区域」——已改为与彩色版
>    **同一 alpha 轮廓**派生（见 `INTEGRATION.md`「单色版派生规则」）。

## 本次定稿范围

- 以 `source/approved-concept-original.png` 为**唯一视觉母版**；保留原图的旋转虹膜、中心星点和蓝青折射。
- 清除源图外围极低 alpha 的噪声和附着毛边，并统一裁切、内边距和抗锯齿。
- 浅色、深色和紫色三种彩色版本共享**完全相同的 alpha 轮廓**，仅改变内部光色。单色深/浅也共享彼此完全相同的轮廓。
- 全部为 PNG 真透明背景；锁屏/应用磁贴和 .ico 为刻意的不透明深海蓝底。
- 导出常用 16/24/32/48/64/96/128/180/192/256/512/1024px 图标与标准 PNG 字标。

## 推荐用法

- 顶栏/认证/页脚：`png/icon/iris-optical-primary-1024.png` (Light)；`iris-optical-dark-1024.png` (Dark)，用 `width/height=28~36` + `object-fit: contain`。
- 管理端：`png/icon/iris-optical-admin-purple-1024.png`，与用户端为同一外形；可把紫色作为容器/背景强调，而不改变品牌符号。
- 浏览器 favicon：`png/favicon/iris-favicon.ico`；透明图标源 `png/icon/iris-icon-32.png`。
- 纯单色印刷与小图标：`png/mono/iris-optical-mono-navy-1024.png` 和 `iris-optical-mono-white-1024.png`。~~单色版为轻量化通用几何近似，会移除中心暗色渐变区域~~ —— **已被项目决策取代**：本仓库现用的单色版从彩色母版按同一 alpha 轮廓派生，保留中心结构，见 `INTEGRATION.md`；原始文件存于 `vendor-original/`。
- 字标：优先在 React 中渲染项目内已有的 **Manrope** `Iris` 文本，而不要使用位图字标放大到任意尺寸。`png/lockup/` 为展示和临时物料备选，在此环境使用字形相近的 Noto Sans Display 作为视觉替代，**不代表已经使用 Manrope 的字形度量**。

## QA 口径

- alpha 通道 0..255，四角全透明；不同彩色版本的 alpha 通道按像素完全一致。
- 16px/favicon 能呈现虹膜旋涡轮廓，但微弱镜面细节无法完全保留；应在真实浏览器标签栏做最后验收。
- `preview/` 为静态排版示意，不是真实 React 浏览器截图；尚未修改 `ui` 或部署。
- 建议上线上线前补充商标相似性/独特性检索及实际深浅色 DOM 视觉审核。

## 文件组织

- `source/` 图像生成的彩色母版（仅留作可追溯记录）
- `png/icon/` 彩色透明 PNG 及各尺寸
- `png/mono/` 单色透明 PNG
- `png/lockup/` 横向字标组合 PNG
- `png/favicon/` 不透明应用磁贴和 ICO
- `preview/` 静态品牌展示板和界面概念排版
- `INTEGRATION.md` React 接入建议

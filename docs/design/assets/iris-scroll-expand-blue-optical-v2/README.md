# Iris ScrollExpand · Blue Optical Glass v2

落地页「展开光幕」（`web/src/components/ScrollExpand.tsx`）的候选背景，2026-11-16 由
用户提供的 `Iris_ScrollExpand_Blue_Optical_Glass_v2.zip` 纳入。

这是对原构图**重新调色**得到的光学风格版本，不是重新生成的 UI 画面，也不是新的渲染图。
构图、尺寸、虹膜位置、左侧标题留白全部来自上一版素材。

## 交付物

| 文件 | 原尺寸 | 产品体积 | sha256 |
|---|---|---|---|
| `web/public/scroll-expand-dark.webp` | 1672 × 941 | 143,420 B | `212302e069300a3fce25171c6adae880bcda55abd37d1f5516a29bac5a819151` |
| `web/public/scroll-expand-light.webp` | 1672 × 941 | 190,074 B | `39f43b04f588412cbab113bddd856638744d409eb01e6dd9e9e98343792fb0e8` |

- 沿用原文件名与 16:9 比例，`LandingPage` 的 `src` / `startWidth` / `startHeight` /
  `mediaZoom` 都不用改。
- WebP 使用 quality 86、method 6。原包给的是 quality 91（195 / 263 KB）；
  实测 q86 相对 q91 的 PSNR 为 39.5 / 38.3 dB，画面里只有大面积渐变与光学高光，
  在该质量下肉眼不可分，体积却降 27%。测量方式：PIL 解码后按 8-bit RGB 逐像素计算。
- 质量梯度参考（同一 PNG 母版）：暗 q82 = 112.5 KB / 38.3 dB，暗 q78 = 93.9 KB；
  浅 q82 = 147.6 KB / 37.1 dB，浅 q78 = 122.3 KB。

## 调色口径

- **暗色**：去掉旧版铜金暖调，阴影压到午夜深海蓝（RGB 影子增益 +0.5 / +4.5 / +13），
  虹膜高光抬冰青，紫只落在虹膜右侧外环（`violet_zone` 限制在画面横向 73%–98%）。
- **浅色**：乳白/暖金改为冰川银蓝，阴影微冷，整体饱和度略降。
- 与品牌令牌的对应关系：钴蓝 `--brand-primary`、冰青 `--brand-cyan`、局部极光紫
  `--brand-aurora`（"只做局部点缀"）。旧版暖铜在 Iris 2.0 令牌里没有对应角色。

## 复现

`color_grade.py` 是本次实际使用的处理脚本，比原包版本做了两处收敛：源路径改为参数、
输出质量可配。母版（`Scroll-Expand-dark.png` / `scroll-expand-light.png`，各约 2 MB）
不随仓库提交，由设计侧留存。用同一对母版重跑：

```bash
python color_grade.py \
  --dark-source /path/to/Scroll-Expand-dark.png \
  --light-source /path/to/scroll-expand-light.png \
  --out-dir ./out
```

2026-11-16 实测：重跑结果与交付 WebP 的源 PNG 最大逐像素差异 1/255（PNG 编码取整），
可视为可复现。依赖 Pillow、numpy、opencv-python。

## QA 与边界

- 视觉回归：390 / 768 / 1440 / 1920 × Light / Dark，起点与展开态各一张，
  证据在 `docs/testing/iris-scroll-expand-v2-20261116/`。
- 该图是**品牌装饰用的示意渲染**，不是真实眼底照片、不是患者数据、不是诊断证据；
  与 `alt`、caption 已有的「眼底示意渲染 · 非真实患者影像」口径一致。
- 沿用原 URL 替换，若部署侧对 `/scroll-expand-*.webp` 设了长期缓存，需要发布时
  带一次缓存失效或版本参数。
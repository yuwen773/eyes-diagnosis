# Iris System States 视觉证据

> 采集日期：2026-11-17；分支：`fix/system-states-react-bits`；浏览器：Playwright Chromium 1234（本机兼容构建）。
> 本目录是证据归档真源，不依赖 `D:/tmp`。`before/` 是从 `e65dad66^`（改动前）导出的 web 源码临时起服务后真实截取；`after/` 是当前分支真实页面截取；`compare/` 仅是同尺寸并排图，不是新截图。

## 目录与计数

- `before/`：共 **9 张**，改动前真实浏览器截图（旧 404 重定向、旧错误面板、旧渲染兜底）。
- `after/`：共 **24 张**，当前分支真实浏览器截图（新 404、新错误/重试、新渲染兜底、加载态、注意级状态、restyle 后的 FaultNote 面板）。
- `compare/`：共 **11 张**，左右并排对照；左 BEFORE、右 AFTER。

## 主题与视口

- 主题：通过 `localStorage.theme = light|dark` 注入，截图前断言 `html.dark` 存在/不存在。
- 视口：桌面 1440×900；移动 375×812（404 / 错误 / 详情）；响应式矩阵 390 / 768 / 1024 / 1440 / 1920。
- 网络错误：Playwright `page.route` 返回 HTTP 502；渲染错误：拦截 lazy chunk 注入抛错模块。均为浏览器内真实渲染，不是静态图片拼贴。

## 对照索引

| compare 文件 | before 源 | after 源 | compare |
|---|---|---|---|
| 404-dark-desktop | `before/404-dark-desktop.png` | `after/404-dark-desktop.png` | `compare/404-dark-desktop.png` |
| 404-dark-mobile | `before/404-dark-mobile.png` | `after/404-dark-mobile.png` | `compare/404-dark-mobile.png` |
| 404-light-desktop | `before/404-light-desktop.png` | `after/404-light-desktop.png` | `compare/404-light-desktop.png` |
| 404-light-mobile | `before/404-light-mobile.png` | `after/404-light-mobile.png` | `compare/404-light-mobile.png` |
| fault-panel-restyled-dark-1440 | `before/network-error-dark-desktop.png` | `after/fault-panel-restyled-dark-1440.png` | `compare/fault-panel-restyled-dark-1440.png` |
| fault-panel-restyled-light-1440 | `before/network-error-light-desktop.png` | `after/fault-panel-restyled-light-1440.png` | `compare/fault-panel-restyled-light-1440.png` |
| network-error-dark-desktop | `before/network-error-dark-desktop.png` | `after/network-error-dark-desktop.png` | `compare/network-error-dark-desktop.png` |
| network-error-dark-mobile | `before/network-error-dark-mobile.png` | `after/network-error-dark-mobile.png` | `compare/network-error-dark-mobile.png` |
| network-error-light-desktop | `before/network-error-light-desktop.png` | `after/network-error-light-desktop.png` | `compare/network-error-light-desktop.png` |
| network-error-light-mobile | `before/network-error-light-mobile.png` | `after/network-error-light-mobile.png` | `compare/network-error-light-mobile.png` |
| render-error-light-desktop | `before/render-error-light-desktop.png` | `after/render-error-light-desktop.png` | `compare/render-error-light-desktop.png` |

## 独立目视复核

- `compare/network-error-light-desktop.png`：左为旧细红竖线 + 等宽 FAULT 标签 + 远端重试；右为居中卡片、文字严重度标签、状态读数与近距主行动。右图按钮、标题、元数据完整无裁切。
- `compare/fault-panel-restyled-dark-1440.png`：右图可见完整错误卡（IRIS 状态提示 / 需要处理 / 标题 / 详情 / 502 + 请求端点 / 重试按钮）；暗色主题下严重度同时由文字与红点表达，无裁切。
- `compare/404-light-mobile.png`：右图 375px 下共享顶栏保留，404 主视觉与「回到首页」按钮完整，无横向溢出。

## 取证边界

- 所有截图均来自真实 React 页面与真实后端（网络/渲染失败用浏览器拦截注入），没有伪造数据或手工绘制的 UI。
- `compare/` 只做并排排版；不把同一张图裁成两半冒充 before/after。
- 认证账号类截图不在本目录；E2E 凭据只通过环境变量临时注入，测试结束即删除临时账号。
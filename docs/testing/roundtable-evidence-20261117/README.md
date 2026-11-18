# Roundtable 3.0 视觉验收证据（PR #93）

本目录保存经人工逐张核验的浏览器截图（WebP 压缩缩略图，约 310 KB 总量）。**不是生产资源**，不参与构建，仅作 PR #93 的视觉验收归档。全尺寸原始 PNG 不入库，按文末命令可复跑生成。

## 证据元数据

| 项 | 值 |
| --- | --- |
| 审查基线 | `4e465e12ebbf9974e96b2d204c9d7698df462183`（PR #93 独立对抗审查时的 head） |
| 归档于修复后 HEAD | `codex/iris-roundtable-3` 的新 tip（见 PR 描述）；本目录截图均取自基线 `4e465e12` 的精确检出，修复仅涉及 `MobileNav` 账号区入口，不改工作台视觉 |
| 浏览器 | Chromium 1234（本机 `ms-playwright` 最新主浏览器；Playwright 本地兼容回落），headless |
| 运行环境 | Node 22.21.0；Vite dev（`VITE_COLLABORATION_ENABLED=true`、`COLLABORATION_TEST_BACKEND` 指向隔离测试后端）；主题由页面主题切换按钮驱动，非系统偏好 |
| 验证方式 | PR 自带 Playwright 合成事件/API 测试生成截图（不拦截真实 SSE 语义的事件由测试夹具注入）；生成后由审查者逐张人工查看，断言布局、双主题、可访问名称、无横向溢出 |
| 审查结论 | 通过。三栏桌面（1440）、移动（360/390）、1024 资料抽屉、补证回流、异常状态均无可见断裂；双主题传达一致品牌性格，非颜色翻转 |

> 口径提醒：这些截图来自**合成事件浏览器测试**，与隔离 Java HTTP/SSE/MySQL 联调分开记录。推理与模型为合成接缝，不表示真实模型或临床验收。

## 截图清单

| 文件 | 场景 | 主题 / 视口 | 人工核验要点 |
| --- | --- | --- | --- |
| `01-completed-light-1440.webp` | 协作完成工作台 | Light / 1440 | 三栏（成员 / 会话 / 影像证据）齐整；四角色肖像与状态；事件卡层级；完成卡"待医生复核"独立显示 |
| `02-completed-dark-1440.webp` | 协作完成工作台 | Dark / 1440 | 同结构深色版，语义色（风险/信号）未错位，文字对比度可读 |
| `03-completed-light-360.webp` | 协作完成工作台 | Light / 360 | 成员横排、会话单列、"影像与证据"抽屉按钮；无横向溢出 |
| `04-completed-dark-360.webp` | 协作完成工作台 | Dark / 360 | 同上深色，控件名称与焦点环可见 |
| `05-supplement-light-1440.webp` | 补证回流 | Light / 1440 | Vera 请求补证后阶段显示"正在补证"，Atlas 证据检索重新执行；会话保留更早事实 |
| `06-supplement-dark-1440.webp` | 补证回流 | Dark / 1440 | 同上深色，补证状态与角色 RUNNING 一致 |
| `07-mobile-inspector-light-390.webp` | 资料抽屉 | Light / 390 | 影像查看器全屏按钮、缩放、引用资料/医生复核入口；焦点回到抽屉 |
| `08-mobile-inspector-dark-390.webp` | 资料抽屉 | Dark / 390 | 同上深色，影像与卡片边界清晰 |
| `09-inspector-drawer-light-1024.webp` | 三栏→抽屉过渡 | Light / 1024 | 1024px 共享资料抽屉展开，背景工作台可见，焦点锁在 dialog |
| `10-connection-interrupted-light-1280.webp` | SSE 断线 | Light / 1280 | 连接中断时不显示旧投影，仅保留状态提示；不谎称已连接 |
| `11-execution-failed-dark-1280.webp` | 执行失败 | Dark / 1280 | 失败原因单独呈现，不虚构可发布结果 |
| `12-doctor-review-light-1440.webp` | 医生复核投影 | Light / 1440 | 医生投影进入既有授权复核路由，受控交接元数据按权限展示 |

## 复跑方式

全尺寸截图（含未筛选的 36+ 张）由 PR 的 Playwright 用例生成，写入被 gitignore 的 `web/test-results/roundtable-*`，不会污染生产资源：

```bash
# 在 PR 工作树、已 npm ci 且本机有 Chromium 的前提下：
cd web
VITE_COLLABORATION_ENABLED=true COLLABORATION_TEST_BACKEND=http://127.0.0.1:8081 \
  npx vite --host 127.0.0.1 --port 5199 --strictPort &

E2E_BASE_URL=http://127.0.0.1:5199 \
ROUNDTABLE_EVIDENCE_DIR=/abs/path/to/evidence \
./node_modules/.bin/playwright test e2e/collaboration.spec.ts \
  --workers=3 --reporter=list
```

生成的文件名与本目录缩略图一一对应：`completed-{theme}-{width}.png`、`supplement-{theme}-1440.png`、`mobile-inspector-{theme}-390.png`、`inspector-{theme}-1024.png`、`connection-interrupted-{theme}-1280.png`、`execution-failed-{theme}-1280.png`、`doctor-review-{theme}-1440.png`。完整视口集合：360、390、768、820、900、1024、1280、1440、1920。

本目录 WebP 由上述 PNG 用 Pillow 缩放并 `quality=82, method=6` 生成，仅用于归档查看，不作为像素级回归基线；PR 中没有 `toHaveScreenshot` 之类的像素断言，测试断言聚焦行为（文本、ARIA、无溢出、对比度）。

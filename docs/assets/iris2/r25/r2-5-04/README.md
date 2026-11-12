# R2.5-04 判读工作区 · 视觉证据

2026-11-13 摄于 R2.5 工作树（`localhost:5175`，真实后端代理），Chromium 1234 / SwiftShader。

## 文件

| 文件 | 说明 |
|---|---|
| `{light,dark}-empty-1440-{fold,full}.jpg` | 空态：任务句 + 三步进度 + 上传取景槽 + 读数栏 |
| `{light,dark}-ready-1440-fold.jpg` | 就绪：本机预览、操作带（开始判读 / 移除）、文件读数 |
| `{light,dark}-running-1440-fold.jpg` | 进行中：分划板旋转、真实等待秒表、LIVE 读数 |
| `{light,dark}-error-1440-fold.jpg` | 失败：真实 500 → 行内故障块（可重试），进度条 FAIL |
| `{light,dark}-done-1440-{fold,full}.jpg` | 成功：记录纸（含来源影像、风险、建议、操作带） |
| `{light,dark}-rejected-1440-{fold,full}.jpg` | 拒识：不形成结论，给出原因与人工复核入口 |
| `{light,dark}-empty-{390,768,1920}-fold.jpg` | 三档宽度的空态 |
| `{light,dark}-done-{390,768,1920}-fold.jpg` | 三档宽度的记录纸 |

## 实测

- 390 / 768 / 1440 / 1920 均无横向滚动（`scrollWidth === innerWidth`）。
- 空 / 就绪 / 进行中 / 失败四态走真实后端；「进行中」通过把真实请求延迟 3.2s
  截取，秒表读的是真实等待时长，不是假进度。
- 两轮截图与 `typecheck` / `lint` / `vitest` / `vite build` 过程中 **0 console error**。
- 记录纸宽度 1440 下 1160px（版心内满宽），390 下随版心收缩；`RecordSheet` 未改。

## 判读为什么没有真实成功态

本机后端（:8081）未启动 Python gRPC 算法服务，`POST /api/diagnosis/diagnosis`
返回 500 —— 这正好是真实失败态的截图来源。成功与拒识两态用**真实接口响应形状**的
布局夹具（脚本内 `RESULT` / `REJECTED`），只验证记录纸、拒识条与操作带的排版；
夹具不进入产品代码，也不代表任何真实模型输出。

## 复跑

```bash
# web/ 下先起 vite（:5175，/api 代理到 :8081）
EVIDENCE_USER=<临时账号> EVIDENCE_PASS=<密码> node scripts/evidence/r25-04-diagnosis.mjs
```

脚本会登录、逐态截图并打印 console error 与横向滚动检查；账号请用一次性临时账号，
采完删除。脚本不写任何凭据。

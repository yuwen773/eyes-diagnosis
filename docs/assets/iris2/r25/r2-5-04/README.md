# R2.5-04 判读工作区 · 视觉证据

2026-11-13 摄于 R2.5 工作树（`localhost:5175`，真实后端代理），Chromium 1234 / SwiftShader。
整改后重拍（独立审查 P2-1/2/3：夹具补齐证据链字段、四档宽度全测横向滚动、
补 report.json 与键盘走查）。

## 文件

| 文件 | 说明 |
|---|---|
| `{light,dark}-empty-1440-{fold,full}.jpg` | 空态：任务句 + 三步进度 + 上传取景槽 + 读数栏 |
| `{light,dark}-ready-1440-fold.jpg` | 就绪：本机预览、操作带（开始判读 / 移除）、文件读数 |
| `{light,dark}-running-1440-fold.jpg` | 进行中：分划板旋转、真实等待秒表、READING 读数 |
| `{light,dark}-error-1440-fold.jpg` | 失败：真实 500 → 行内故障块（可重试），进度条 FAIL |
| `{light,dark}-done-1440-{fold,full}.jpg` | 成功：记录纸（含来源影像、类别概率表、建议、证据链、操作带） |
| `{light,dark}-rejected-1440-{fold,full}.jpg` | 拒识：不形成结论，给出原因与人工复核入口 |
| `{light,dark}-{empty,done}-{390,768,1440,1920}-fold.jpg` | 四档宽度 × 空/成功两种版式（横向滚动逐档实测） |
| `{light,dark}-keyboard-1440.jpg` | 顶栏 Tab 走查的焦点态 |
| `report.json` | console error、逐档横向滚动、结论/概率表读数、键盘停靠 |

## 实测（见 report.json）

- 四档宽度 × 空/成功 **16 组**横向滚动检查全部为 false。
- 空 / 就绪 / 进行中 / 失败四态走真实后端；「进行中」通过把真实请求延迟 3.2s
  截取，秒表读的是真实等待时长，不是假进度。进行中读数栏与流程轨同显
  `READING`（同一套状态词），失败即 `FAIL`。
- 键盘走查：Tab 走 12 步直到绕回顶栏，停靠全部可见、全部带可见焦点指示
  （顶栏六个控件 + 上传槽「选择或拖入眼底照片」都在停靠链上）。
- 全程 **0 console error**。
- 概率表读数（done 态，两主题一致）：3 行，`DR 糖尿病视网膜病变 / GLA 青光眼 / N 正常`，
  无英文标签行、主诊断不重复；拒识态 0 行、结论标题换成拒识提示。

## 判读为什么没有真实成功态

本机后端（:8081）未启动 Python gRPC 算法服务，`POST /api/diagnosis/diagnosis`
返回 500 —— 这正好是真实失败态的截图来源。成功与拒识两态用**真实接口响应形状**的
布局夹具（脚本内 `RESULT` / `REJECTED`），只验证记录纸、拒识条与操作带的排版；
夹具不进入产品代码，也不代表任何真实模型输出。

夹具字段与真实后端对齐（不是随手编的数）：

- `result` 用后端枚举的中文短名「糖尿病」，`otherDisease` 用算法给的英文标签
  且 top-1 与主诊断同类——这正是真实响应里会把概率表搞出英文行与重复行的形状，
  也是前端归一逻辑（`canonicalClassName`）要接住的情况；
- `severity: "NOT_ASSESSED"`（活路径上严重度由人工复核给出）、
  `weightSha256` / `preprocessVersion` / `qualityScore` 来自医疗安全证据链；
- 建议文本与 `DiagnosisRecommendationEnum` 的 diabetes 条目一致，
  描述文本与算法侧 `DISEASE_DESCRIPTIONS.diabetes` 一致。

## 复跑

```bash
# web/ 下先起 vite（:5175，/api 代理到 :8081）
EVIDENCE_USER=<临时账号> EVIDENCE_PASS=<密码> node scripts/evidence/r25-04-diagnosis.mjs
```

脚本会登录、逐态截图、写出 `report.json`（console error、横向滚动、概率表读数、
键盘停靠），有 console error 时以非零码退出。账号请用一次性临时账号，采完删除；
脚本不写任何凭据。

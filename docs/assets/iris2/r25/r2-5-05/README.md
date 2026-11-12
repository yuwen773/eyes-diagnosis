# R2.5-05 诊断 Agent 工作区 · 视觉证据

2026-11-13 摄于 R2.5 工作树（`localhost:5175`，真实后端代理），Chromium 1234 / SwiftShader。
整改后重拍（独立审查 P1-4 / P2-4 / P2-5：六种卡逐类计数、欢迎屏选图手势链路、
窄屏滚动尺寸入 report）。

## 文件

| 文件 | 说明 |
|---|---|
| `{light,dark}-welcome-{390,768,1440,1920}-fold.jpg` | 空会话：金属虹膜标 + 三条真实入口 + 输入区 |
| `{light,dark}-welcome-390-full.jpg` | 390 整页（会话栏收起后的首屏） |
| `{light,dark}-sessions-1440.jpg` | 会话栏：真实会话、分组、行内操作入口 |
| `{light,dark}-history-real-1440.jpg` | 点开真实会话后加载的真实历史（一条用户消息） |
| `{light,dark}-transcript-1440-{top,bottom}.jpg` | 完整消息流：用户 / 思考 / 工具调用 / 工具结果 / 助手 / 确认 |
| `{light,dark}-composer-focus-1440.jpg` | 键盘焦点：textarea 自身焦点环保留 + 容器柔光（`:focus-within`） |
| `{light,dark}-composer-attachment-1440.jpg` | 选图预览附件、发送键进入可发送态 |
| `{light,dark}-composer-welcome-pick-1440.jpg` | 点欢迎屏「上传眼底图像」卡片：附件进输入区、引导句预填 |
| `{light,dark}-sessions-390-expanded.jpg` | 390 点汉堡展开会话栏（默认收起） |
| `{light,dark}-sessions-390-after-select.jpg` | 选完真实会话后会话栏自动收回 |

## 实测（见 report.json）

- 390 / 768 / 1440 / 1920 均无横向滚动（`scrollWidth === innerWidth`）。
- 全程 **0 console error**。
- 六种消息卡逐类计数（两主题一致）：user 1 / assistant 1 / reasoning 1 /
  工具卡 2 / mcp-confirm 1——与夹具构造一一对应，不再只数到 2。
- **欢迎屏选图手势链路实测**：点「上传眼底图像」卡片触发文件选择对话框
  （Playwright filechooser 事件，`welcomeCardOpensPicker: true`），
  选完图附件进输入区、引导句「帮我解读这张眼底照片」预填进输入框
  （`draftText` 为该句的 UTF-8，不替用户发送）。
- 窄屏（≤900）会话栏默认收起（`defaultCollapsed: true`）、点汉堡展开
  （`expandedCollapsed: false`）、选完真实会话自动收回
  （`autoCollapsedAfterSelect: true`）；会话栏内滚动尺寸实测写入报告
  （`scrollHeight 169 / clientHeight 111`，可滚）。
- `typecheck` / `lint` / `vitest`（317 passed，含 ChatInput pickImage/prefill/
  附件直发/草稿与 AgentPage 窄屏断点 4 条新测试）/ `vite build` 全绿。

## 完整消息流为什么是夹具

本机后端的 LLM 通道不可用：`POST /api/agent/chat/stream` 返回 200 后立即结束、
没有事件（重试多次一致），因此无法产生真实的助手回复。完整消息流用**真实历史接口
响应形状**的布局夹具（脚本内 `TRANSCRIPT`），只为一次覆盖六种消息卡的排版；
夹具不写入产品代码，也不代表任何真实模型输出。其余状态均为真实数据：
会话列表里的两条会话由真实发送动作产生（后端已建会话、已存用户消息），
历史页加载的是真实 `GET /api/agent/history/{threadId}` 响应。

## 复跑

```bash
# web/ 下先起 vite（:5175，/api 代理到 :8081）
EVIDENCE_USER=<临时账号> EVIDENCE_PASS=<密码> node scripts/evidence/r25-05-agent.mjs
```

脚本会登录、逐态截图，写出 `report.json`（console error、横向滚动、六种卡计数、
选图手势与预填读数、窄屏滚动尺寸），并在有 console error 时以非零码退出。
账号请用一次性临时账号，采完删除；脚本不写任何凭据。

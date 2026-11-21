# R3 Agent 验收证据

这些截图由 `web/scripts/evidence/r3-agent-acceptance.mjs` 在真实 Chromium 里生成，
复跑：

```bash
cd web
# 1) 另开终端起前端（无需后端也能跑：会话/历史/SSE 全部合成）
VITE_PROXY_TARGET=http://localhost:18081 npx vite --port 5199 --strictPort
# 2) 采集
ACCEPT_BASE=http://localhost:5199 node scripts/evidence/r3-agent-acceptance.mjs
```

**边界**：SSE 分片由页面内补丁的 `fetch` 按时间逐条吐出，会话与历史接口由 Playwright
拦截；渲染、滚动、停止、主题、视口、时区换算走产品代码。真实模型链（真 SSE + 真工具）
由 `r3-agent-real-backend.mjs` 单独验证，两者不互相代替。

| 文件 | 场景 | 看什么 |
| --- | --- | --- |
| `light-rich-streaming-1440.jpg` | 流式中 | 标题/列表已成形，光标画在最后一块行末，表格还没出现（不过早显示半张表） |
| `light-rich-final-1440.jpg` | 流结束 | 标题、列表、表格、引用、代码块的层级与行距 |
| `dark-rich-final-1440.jpg` | 深色同上 | 深色下同一套层级与对比 |
| `dark-rich-final-375.jpg` | 375px | 窄屏不横向溢出，正文仍是读物宽度 |
| `dark-tool-error-1440.jpg` | 工具失败 | 状态「失败」+ 一句「不能当作医学证据」，结果与参数分层 |
| `light-tool-multi-1440.jpg` | 两工具乱序返回 | 两步各自配对，都显示「完成」，不串结果 |
| `light-tool-missing-1440.jpg` | 无回执 | 「未确认」只陈述事实，不承诺回执、不谎报完成 |
| `light-tool-completed-1440.jpg` | 只有 `completed`、没有成败判定 | 显示「已返回」，不画实心对勾，并说明工具输出不是诊断结论 |
| `light-tool-timeout-1440.jpg` | 超时 | 琥珀淡底药丸 + 中性说明；不穿失败红，也不把橙色当「出错」 |
| `light-history-1440.jpg` | 历史恢复 | 工具结果回放为「完成」；UTC 10:20 显示为本地 18:20 |

完整断言表与全部截图在 `web/test-results/r3-acceptance/report.json`（不提交，可复跑再生）。

## Phase R：会话资源与证据闭环

复跑（真实浏览器，合成事件；上传接口与 SSE 分片均为合成，面板逻辑走产品代码）：

```bash
cd web
# 1) 另开终端起前端
VITE_PROXY_TARGET=http://localhost:18081 npx vite --port 5199 --strictPort
# 2) 采集
ACCEPT_BASE=http://localhost:5199 node scripts/evidence/r3-resources-acceptance.mjs
```

真实后端联调（真实上传 COS、真实 DashScope 模型、真实 Chroma 检索，不拦截任何请求）：

```bash
cd web
R3_API_BASE=http://localhost:18081/api node scripts/evidence/r3-resources-real-backend.mjs
```

脚本会注册临时账号，并在结束时删除本轮上传的对象；临时账号请按需自行清理（本仓库不保留测试账号）。

| 文件 | 场景 | 看什么 |
| --- | --- | --- |
| `light-resources-panel-1440.jpg` | 上传 + 检索命中 + 链接 | 会话级汇总、三类 tab 计数、来源卡（相关度 0.81 / `#42` / 片段）、定位按钮 |
| `dark-resources-panel-1440.jpg` | 深色同上 | 深色下同一套层级与对比 |
| `light-resources-preview-1440.jpg` | 影像预览 | 点缩略图打开预览层，尺寸受控 |
| `light-resources-drawer-375.jpg` | 375px 抽屉 | 窄屏资源面板不挤占正文宽度 |
| `light-resources-failed-tool-1440.jpg` | 失败工具却带资源 | 来源计数为 0，不让失败的工具长出一份假证据 |
| `dark-resources-interrupted-1440.jpg` | 断流 | 没有回执的一轮不产出来源 |
| `light-resources-history-1440.jpg` | 历史恢复 | 刷新/换会话后影像与来源从落库消息重建 |

**边界**：`资源栏显示 0` 是合法空态（这个会话确实没有影像 / 没有命中 / 没有外链）。
合成验收与真实后端验收的结果不互相代替：真实链只覆盖「模型确实触发了 searchDocuments」
这一条路，模型没触发时以合成用例为准。

### 四路评审后的整改（2026-11-18，同一工作树）

四份独立评审（后端/Agent 正确性、前端并发与渲染、安全与医学边界、UI/UX 与可访问性）
的 P1 与低成本 P2 已修，剩余项记为债务见下。

| 改动 | 位置 | 为什么 |
| --- | --- | --- |
| MCP 工具 `isError=true` 抛错 | `agent/mcp/McpToolCallback.java` | 不再把「401 Unauthorized」当成功文本喂给模型与前端 |
| 脱敏器重写（值带空格 / 键名带空格 / URL userinfo / 二次转义 JSON / PGP） | `utils/SensitiveDataRedactor.java` + 10 条单测 | 原来 `Basic <base64>` 只打掉 `Basic` |
| 工具参数、确认文案、推理与正文出站前统一脱敏 | `agent/DiagnosisAgent.java` | 凭据不落库、不进 SSE |
| Agent 正文不放行远程图片 | `lib/sanitize.ts` | 与文档预览同一口径，堵像素追踪外带通道 |
| `completed` / 未知 status → 「已返回」，不再是 ✓「完成」 | `lib/agentSteps.ts`、`ThoughtLine` | 框架返回了结果 ≠ 执行成功 |
| 旧数据无 `toolCallId` 时按先进先出配对 | `lib/agentSteps.ts` | 原来取最后一个未回执，第一步永远停在「未确认」 |
| 流式光标画在最后一块行末 | `agent.css`、`AssistantMessage.tsx` | 原来是游离的方块；顺带补 `role="status"` 播报与 `aria-busy` |
| StrictMode 下合帧停摆修复 | `lib/useStreamingMarkdown.ts` + 回归测试 | cleanup 只 `clearTimeout` 不置空，重挂载后再不排帧 |
| 状态药丸：失败 `--risk-critical`、超时回中性、`--fg-2` 替换不达标的 `--fg-3` | `agent.css` + `tokens.contrast.test.ts` | 错误色不用品牌橙；11px 药丸从 4.13:1 抬到 ≥4.5 |

**验收口径变化**：合成 harness 的「无页面错误」只统计 JS 异常与真正的控制台错误，
`Failed to load resource` 这类网络层噪声（dev server 复位 keep-alive、例子域名取不到图）
单独记账、不进断言；场景内有意义的失败另有逐条断言。

**已知债务（登记未修）**：`agent.css` 仍按元素重定义 `markdown.css` 的基础排版（应抽
`.is-prose` 变体）；`suppressHighlight` 仍是模块级标志（同步调用内安全，但脆）；
正文行宽 34em 的理想值未调（会与表格/代码块布局冲突，需要单独一轮）；
`stableBoundary` 每次从 0 扫描（正确性无碍，成本可忽略）。

## 合并前最后一轮：来源与模型片段一致（2026-11-18）

**修的是什么**：`DocumentSearchTool.searchDocuments()` 原来在 rerank 与 `finalTopK`
确定之前就登记结构化来源，侧栏可能出现模型从没见过的候选，分数也停在检索分上。
现在先定「最终交给模型的片段」（rerank → `finalTopK`），再从**同一份结果**登记来源：
同集合、同顺序、同分数。

**两种分数的语义**（`ResourceRef`）：

| 字段 | 含义 | 何时有值 |
| --- | --- | --- |
| `score` | 最终排序分：rerank 生效时是重排序分，否则是文档自带检索分 | 检索结果带分数时 |
| `retrievalScore` | 原始检索分（向量相似度） | 只在 rerank **成功**且给了分时单独记录；其余为空 |

rerank 抛错或返回空结果时回退到原始检索顺序：`score` 就是检索分、`retrievalScore`
为空、正文不印「相关度」——回退只影响排序质量，不冒充重排序分，也不改变「这次调用成功」。

**新增测试**：`DocumentSearchToolCitationTest` 6 条（命中数 > `finalTopK`、rerank 改序、
rerank 异常回退、空响应回退、rerank 无分结果、无 `docId` 不登记）；
`ToolResourceContextTest` 4 条（跨线程不可见、`drain` 即清空、重复 id 只留首条、取走的是快照）。

**线程前提**（已写进 `ToolResourceContext` 注释）：`ReactAgent` 用默认配置
（`parallelToolExecution=false`、`wrapSyncToolsAsAsync=false`），`executeSyncTool`
在拦截器同一线程里直接调 `ToolCallback.call()`，线程内收集才成立；将来开启并行/异步
包装必须改成显式传递，否则资源会静默丢失。

### 真实后端复跑（同一 HEAD 的 jar，profile `local,dev`）

真实 COS、真实 DashScope（qwen + gte-rerank-v2）、真实 Chroma，脚本不拦截任何请求
（先起后端：`java -jar target/eye-diagnosis-1.1.0.jar --server.port=18081
--spring.profiles.active=local,dev`，然后 `R3_API_BASE=http://localhost:18081/api node
scripts/evidence/<脚本>.mjs`；18081 被别的实例占用时换个端口，`R3_API_BASE` 跟着改即可 ——
下表数字取自 2026-11-18 在 18082 的一次复跑）：

| 脚本 | 结果 |
| --- | --- |
| `r3-agent-real-backend.mjs` | 187 个 SSE 时间戳全部带时区偏移；`searchDocuments` → `success`（结果 2604 字符）；6 条历史消息时间带偏移；`done` 收口 |
| `r3-resources-real-backend.mjs` | COS 上传可达 HTTP 200；tool-result 携带 2 条结构化引用：`builtin:05-glaucoma`（rerank 0.1998 / 检索 0.7124）、`builtin:01-normal`（0.1808 / 0.5697）；历史恢复出同一批 2 条来源；上传对象已删除 |
| `r3-authz-real-backend.mjs` | B 读 A 的历史 → `40101`（不泄露消息）；B 的会话列表 0 条；未登录 → `40100`；A 自读 3 条（正对照） |

真实链**未覆盖**：工具失败 / 超时 / 中断的真实链路（不破坏共享服务就无法稳定构造），
仍由合成用例 `tool-error` / `tool-timeout` / `tool-completed` 覆盖；这两类证据不互相代替。
**生产启用前应单独安排隔离环境的故障注入**（断链、超时、取消），验证界面状态、落库与
资源丢弃三条链路。

**三条需要长期记住的边界**：

1. **资源上下文依赖同步执行模型**：`ToolResourceContext` 是 ThreadLocal，成立的前提是
   `parallelToolExecution=false` 且 `wrapSyncToolsAsAsync=false`（工具与拦截器同线程）。
   一旦开启并行工具或异步包装，必须改成显式传播（`ToolContext` / `ToolCallRequest.context`），
   否则资源会静默丢失——这是架构约束，不是可选优化。
2. **来源粒度是文档级，不是段落级**：没有 `docId` 的片段仍会交给模型、但不登记来源；
   同一文档的多个片段按 `doc:<documentId>` 去重合并，侧栏只保留先登记那一段的片段与分数。
   不是回归，但做精确的段落级证据引用时必须解决（需要 chunk 级标识与逐段映射）。
3. **两个分数不可比**：`score`（重排序分）与 `retrievalScore`（向量相似度）量纲不同，
   不要并排展示或相减；界面上只显示 `score`。

产物 JSON 在 `web/test-results/r3-acceptance|r3-resources|r3-authz/`（`web/.gitignore` 忽略，可复跑再生）。
本轮回归：`scripts/verify.sh` 绿（270 单测，3 skipped + 4 条 MySQL 集成）；前端 730 单测 /
typecheck / lint / build 绿；合成验收 154 + 45 条断言 0 失败。临时账号与上传对象已清理。


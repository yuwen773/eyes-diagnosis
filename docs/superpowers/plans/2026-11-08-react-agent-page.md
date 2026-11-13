# React 版 Agent 对话页移植实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Vue 版 Agent 智能对话全功能移植到 `web/` React 前端——SSE 流式对话、会话管理（新建/切换/删除/重命名/置顶/导出）、图片上传（所有权账本）、资源面板、工具调用/推理展示。

**Architecture:** 逻辑层从 Vue composables 直译为 React hooks（框架无关部分 `fetchEventSource`/`markdown-it`/`highlight.js` 原样复用）；UI 层跟随 `web/` 的「白色仪器」语言新写——`is-field` 亮色测量台双栏布局，trace 行视觉沿用 app.css 已有的 `.console/.trace` 暗底会话屏（作为页面内反相带）。TOOL_CONFIRM 做成信息性终点卡（后端无确认回传端点，见 Spec 附录）。

**Tech Stack:** React 19 + TS、@microsoft/fetch-event-source（新增）、markdown-it + highlight.js（新增）、手写 CSS（新增 `web/src/styles/agent.css`）、react-router-dom 7。

**Spec:** 本计划实现以下决策（用户已确认）：
1. 功能范围 = 全功能对齐 Vue 版（LeftSidebar 1079 行的功能基本对齐）
2. MCP 设置面板（SettingsModal + McpServicePanel + McpServerForm）**不搬**
3. TOOL_CONFIRM **不做真确认**——后端 `DiagnosisAgent.java:192-203` 的 TOOL_CONFIRM 来自 `InterruptionMetadata`（图中断），`AgentController` 无 confirm/resume 端点、无 checkpointer，中断即流结束、状态无持久化。React 版把确认卡做成信息性终点卡，去掉假的确认按钮。

## Global Constraints

- 所有路径相对仓库根 `D:\Work\code\eye-diagnosis\.claude\worktrees\web-react`；React 应用在 `web/`。
- 所有命令在 `web/` 目录下运行；测试命令 `npx vitest run <file>`（vitest 未配置也要先装：`npm i -D vitest`；如项目无 vitest 配置，用 `npx vitest run --passWithNoTests` 不适用——直接装依赖即可）。
- API 信封 `{code:0, data, msg}`；错误统一抛 `ApiError`（`web/src/lib/api.ts:8`）；40100 = 未登录。
- SSE 请求**不走** `request<T>`（它解 JSON 信封会破坏流）；单独写 `streamChat`。
- BASE_URL 用 `import.meta.env.VITE_API_BASE_URL ?? "/api"`（与 `web/src/lib/api.ts:6` 一致，**不带** `/api` 重复前缀）。
- 雪花 id 一律 `string` 类型（sessionId、messageId）。
- 样式只写手写 CSS（不用 Tailwind utility），新样式进 `web/src/styles/agent.css`，在 `web/src/index.css` 里 `@import`。
- 组件样式只消费上下文令牌（`--fg/--fg-2/--fg-3/--hr/--signal` 等）；`.console` 反相带内用现有 `--dark/--on-dark/--dark-line`。
- 双主题（`html.dark`）必须两个主题都验证——只要消费上下文令牌即自动成立。
- AI 装饰零容忍：欢迎屏不做粒子/云雾/发光动画（Vue 版欢迎屏违规，不移植其视觉）。
- React 版修复 Vue 版已知 bug，不复制：① 资源提取正则三份合一（用 `(?<!!)` 正确负预查）；② confirm 假按钮去掉；③ 会话操作后必须刷新列表（Vue 版 loadSessions prop 没绑导致不刷新）。
- dev 环境 Vite 代理 `/api → http://localhost:8081`（`web/vite.config.ts:16-22` 已配）。
- 测试框架：新增 `vitest`（`npm i -D vitest`），纯逻辑层做单测；UI 组件不做组件测试（项目无组件测试先例）。
- 每个任务完成即 commit（中文约定式提交 + `Co-Authored-By: Claude Code <noreply@anthropic.com>` 尾行）。

## Review Focus

以下输入/故障模式规格未覆盖测试，人工验收时优先盯：

1. **SSE 提前断连**（网络闪断、后端重启）：收不到 `done` 事件——期望：前端报「连接中断」而非静默挂着，已上传图片被回滚删除，不产生 COS 孤儿。→ Task 3 测试 `abrupt close without done` 钉住。
2. **并发双开页面同时发消息**（同 threadId 两个 tab）：后端按 sessionId 串行持久化，前端各自 SSE——期望：各自渲染自己回合，互不串写消息列表。→ 验收时人工开双 tab 检查（不自动化）。
3. **暗房主题下的 console 反相带**：`html.dark` 下页面是暗的，`.console` 也是暗的——期望：仍有发丝线区分层级，trace 角色标签/工具卡在暗房下可读。→ Task 8 验收步骤人工切主题检查。
4. **历史消息里 mcp-confirm（旧数据）**：DB 存量 subType=`mcp-confirm` 的消息——期望：映射为信息性终点卡渲染，不出现确认按钮，不报错。→ Task 7 测试 `history mcp-confirm maps to confirm-card` 钉住。
5. **粘贴超多图 / 上传中途网络断**：uploadFiles 部分成功后失败——期望：本批次已成功 URL 被逐个 release（最后持有者真正删除），用户看到上传失败提示，消息不发送。→ Task 5 测试 `rollback partial batch` 钉住。

---

## File Structure

```
web/src/
├── lib/
│   ├── api.ts                  # [修改] 追加 agent 域 API + streamChat（SSE 专用，不包信封）
│   ├── agentStream.ts          # [新建] SSE 事件解析核心（纯函数 reducer + 连接管理 hook）
│   ├── agentUpload.ts          # [新建] 上传去重 + commit/rollback
│   ├── agentImageOwnership.ts  # [新建] 图片引用计数账本（原样移植）
│   ├── agentResources.ts       # [新建] 资源提取（唯一一份正则，修复 Vue 版 (?!!) bug）
│   └── markdown.ts             # [新建] markdown-it + hljs 渲染（原样移植 utils/markdown.ts）
├── pages/
│   └── AgentPage.tsx           # [重写] 页面编排（对标 AgentChatPage.vue，含登录守卫）
├── components/agent/
│   ├── SessionList.tsx         # [新建] 左栏会话列表（分组/多选删/重命名/置顶/导出）
│   ├── MessageList.tsx         # [新建] 消息路由 + 打字指示 + 滚动/未读
│   ├── WelcomeScreen.tsx       # [新建] 欢迎屏（按白色仪器语言重写，无动画装饰）
│   ├── ChatInput.tsx           # [新建] 自适应 textarea + 粘贴图 + 附件条 + 发送/停止
│   ├── messages/
│   │   ├── UserMessage.tsx     # [新建] 右对齐 + 图片网格
│   │   ├── AssistantMessage.tsx# [新建] markdown 渲染 + 代码块复制
│   │   ├── ReasoningMessage.tsx# [新建] 可折叠思考过程
│   │   ├── ToolRequestMessage.tsx # [新建] 工具调用卡
│   │   ├── ToolResponseMessage.tsx# [新建] 返回卡（>120 字符折叠）
│   │   └── ConfirmMessage.tsx  # [新建] 信息性终点卡（无确认按钮）
│   └── ResourcePanel.tsx       # [新建] 图片/链接双 tab 面板
└── styles/
    └── agent.css               # [新建] agent 页全部样式（is-field 语境 + console 反相带复用）
```

## Interfaces（跨任务契约总表）

**`lib/agentStream.ts`（Task 3）**
```ts
export type StreamMsgType = "user" | "assistant" | "reasoning" | "tool-request" | "tool-response" | "confirm"
export type ToolCallArg = { name: string; args: Record<string, unknown> }
export type StreamMessage = {
  id: string                    // crypto.randomUUID()，React key 用
  type: StreamMsgType
  content: string
  isLoading?: boolean           // 仅 assistant 流式中有
  toolName?: string
  toolCalls?: ToolCallArg[]
  time?: string                 // "HH:mm"
  images?: string[]
}
export type AgentResources = {
  images: { url: string; title: string }[]
  links: { url: string; title: string; domain: string }[]
}
export function useAgentStream(): {
  messages: StreamMessage[]          // state
  isStreaming: boolean
  resources: AgentResources          // state（累积）
  send(message: string, threadId: string, urls: string[]): Promise<void>
  abort(): void
  pushUser(msg: StreamMessage): void
  /** 历史加载用：整表替换消息（Task 10 getChatHistory 后调用） */
  setMessages(msgs: StreamMessage[]): void
  reset(): void
}
export function mapHistoryMessage(m: HistoryMessageVO): StreamMessage  // Task 3 导出，Task 6 用
```

**`lib/api.ts` 追加（Task 1）**——签名与后端 `AgentController.java` 一一对应：
```ts
export type AgentSessionVO = { sessionId: string; title: string; lastMessage: string; messageCount: number; summaryContent: string; createdTime: string; updatedTime: string; isPinned?: boolean }
export type HistoryMessageVO = { id: number; role: string; subType: string; content: string; isSummary: boolean; createdTime: string }
export type ChatHistoryVO = { messages: HistoryMessageVO[]; hasMore: boolean; nextCursor: number | null }
export function getSessions(beforeId?: string, limit?: number): Promise<AgentSessionVO[]>
export function deleteSession(sessionId: string): Promise<boolean>
export function batchDeleteSessions(sessionIds: string[]): Promise<number>
export function updateSessionTitle(sessionId: string, title: string): Promise<boolean>
export function updatePinStatus(sessionId: string, pinned: boolean): Promise<boolean>
export function generateTitle(sessionId: string, firstMessage: string): Promise<boolean>
export function getChatHistory(threadId: string, beforeId?: number, limit?: number): Promise<ChatHistoryVO>
export function exportSession(sessionId: string, format: "markdown" | "json"): Promise<string>
export function uploadAgentImage(file: File): Promise<string>
export function deleteAgentImage(url: string): Promise<void>
export function streamChat(body: { message: string; threadId: string; imageUrls?: string[] }, handlers: {...}, signal: AbortSignal): Promise<void>
```

**`lib/agentImageOwnership.ts`（Task 4）**：`acquireAgentImage(url)` / `retainAgentImage(url)` / `releaseAgentImage(url)`，与 Vue 版逐行等价。

**`lib/agentUpload.ts`（Task 5）**：`useAgentUpload(): { uploadFiles(files: File[]): Promise<{urls: string[]}>; commitSuccess(urls: string[]): void; commitFailure(urls: string[]): void }`

**`lib/agentResources.ts`（Task 2）**：`extractResources(content: string, prev: AgentResources): AgentResources`（纯函数，去重累积）。

**`lib/markdown.ts`（Task 2）**：`renderMarkdown(content: string): string`（markdown-it + hljs，`html:false`）。

**组件 props（Tasks 7–10）**：
- `<SessionList sessions activeId busy onNewChat onSelect onRename onDelete onBatchDelete onTogglePin onExport onCollapse />`
- `<MessageList messages loading streaming onSend />`（欢迎屏内嵌，messages 为空且非 loading 时显示）
- `<ChatInput disabled streaming onSend(text, files) onStop />`
- `<ResourcePanel open resources onClose onPreviewImage(url) />`
- `<ConfirmMessage content />` ——纯展示，无按钮（决策 #3）

---

### Task 1: 依赖 + agent 域 API 层

**Files:**
- Modify: `web/package.json`（依赖）
- Modify: `web/src/lib/api.ts`（追加 agent 域）

**Interfaces:**
- Consumes: `request<T>`、`ApiError`、`BASE_URL`（api.ts 现有）
- Produces: 上文 Interfaces 总表 `lib/api.ts` 追加部分的全部签名；`AgentSessionVO/HistoryMessageVO/ChatHistoryVO` 类型

- [ ] **Step 1: 安装依赖**

```bash
cd web && npm i @microsoft/fetch-event-source markdown-it highlight.js && npm i -D vitest @types/markdown-it
```

- [ ] **Step 2: 在 `web/src/lib/api.ts` 末尾追加 agent 域**

要点：
- 普通 REST 端点全部走现有 `request<T>`（修复 Vue 版「手写 fetch 不校验 code」的双轨制）
- `getSessions(beforeId?: string, limit = 20)`：query 参数拼 `?limit=${limit}`，beforeId 存在时追加 `&beforeId=${beforeId}`（注意 beforeId 是数字语义但按 string 传，后端 `Long`）
- `streamChat` **不**走 `request<T>`：直接 `fetch(`${BASE_URL}/agent/chat/stream`, { method:"POST", headers:{Accept:"text/event-stream","Content-Type":"application/json"}, credentials:"include", body: JSON.stringify(body), signal })`，`response.ok` 为假时抛 `ApiError(response.status, ...)`；返回 `response` 的 handler 交给 Task 3——本任务签名定为 `streamChat(body, handlers, signal): Promise<void>`，内部用 `fetchEventSource` 实现并在 `onclose` 未收到 `done` 时抛 `ApiError(-1, "连接中断")`。handlers 形状：`{ onEvent(dto: AgentStreamDTO): void; onDone(): void; onError(err: unknown): void }`，其中 `AgentStreamDTO = { messageType: string; content?: string; toolCalls?: { name: string; arguments: string }[] }`。实现放本任务（fetchEventSource 已装），Task 3 只做事件→消息 reducer。

- [ ] **Step 3: 类型检查 + 提交**

Run: `cd web && npm run typecheck`
Expected: PASS（新增导出无人引用不算错误）

```bash
git add web/package.json web/package-lock.json web/src/lib/api.ts
git commit -m "feat(web): agent 域 API 层与 SSE 依赖"
```

### Task 2: 纯函数层——markdown 渲染 + 资源提取

**Files:**
- Create: `web/src/lib/markdown.ts`
- Create: `web/src/lib/agentResources.ts`
- Test: `web/src/lib/agentResources.test.ts`

**Interfaces:**
- Consumes: `markdown-it`、`highlight.js`（Task 1 装）
- Produces: `renderMarkdown(content: string): string`；`extractResources(content, prev): AgentResources`、`AgentResources` 类型（定义在 agentResources.ts，agentStream.ts 从这里 import）

- [ ] **Step 1: 写失败测试 `web/src/lib/agentResources.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { extractResources } from "./agentResources"

const EMPTY = { images: [], links: [] }

describe("extractResources", () => {
  it("提取 markdown 图片", () => {
    const r = extractResources("看 ![眼底图](https://cos.example.com/fundus.jpg) 结果", EMPTY)
    expect(r.images).toEqual([{ url: "https://cos.example.com/fundus.jpg", title: "眼底图" }])
    expect(r.links).toEqual([])
  })
  it("提取非图片链接且排除图片语法（Vue 版 (?!!) bug 的回归测试）", () => {
    const r = extractResources(
      "参考 [指南](https://med.org/guide) 与 ![图](https://cos.example.com/a.jpg)",
      EMPTY,
    )
    expect(r.links.map((l) => l.url)).toEqual(["https://med.org/guide"])
    expect(r.images.map((i) => i.url)).toEqual(["https://cos.example.com/a.jpg"])
  })
  it("累积时按 URL 去重", () => {
    const one = extractResources("![a](https://x/1.jpg)", EMPTY)
    const two = extractResources("![a](https://x/1.jpg)", one)
    expect(two.images).toHaveLength(1)
  })
  it("无效 URL 不产生链接条目", () => {
    const r = extractResources("[坏](::::not-a-url)", EMPTY)
    expect(r.links).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/agentResources.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `agentResources.ts`**

`extractResources(content, prev)` 纯函数：图片正则 `/!\[([^\]]*)\]\(([^)]+)\)/g`；链接正则 `/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g`（lookbehind，Node 21+ 支持；与 Vue 版 `(?!!)` 的区别是本版有效）。链接条目 `{ url, title, domain: new URL(url).hostname }`，`new URL` throw 则跳过。返回新对象（不 mutate prev）。`AgentResources` 类型从这里导出。

- [ ] **Step 4: 实现 `markdown.ts`**

从 `frontend/src/utils/markdown.ts` 原样移植（markdown-it `html:false, linkify:true, typographer:true` + hljs highlight + 代码块 header/copy 按钮 HTML + `DIAGRAM_LANGUAGES` 常量）。导出 `renderMarkdown`。注意：Vue 版是 ESM 无 Vue 依赖，直接搬，改 import 路径即可。

- [ ] **Step 5: 跑测试确认通过 + typecheck + 提交**

Run: `cd web && npx vitest run src/lib/agentResources.test.ts && npm run typecheck`
Expected: PASS

```bash
git add web/src/lib/markdown.ts web/src/lib/agentResources.ts web/src/lib/agentResources.test.ts
git commit -m "feat(web): agent markdown 渲染与资源提取"
```

### Task 3: SSE 流核心 hook

**Files:**
- Create: `web/src/lib/agentStream.ts`
- Test: `web/src/lib/agentStream.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `streamChat` + `AgentStreamDTO`；Task 2 的 `extractResources` + `AgentResources`
- Produces: 上文 Interfaces 总表 `lib/agentStream.ts` 的全部导出（`useAgentStream`、`mapHistoryMessage`、`StreamMessage`、`StreamMsgType`、`ToolCallArg`）

- [ ] **Step 1: 写失败测试 `web/src/lib/agentStream.test.ts`（纯 reducer 层测试）**

把事件→消息的转换做成导出的纯函数 `applyStreamEvent(state, dto): StreamMessage[]`（state = 当前 messages 数组），hook 里只是 setState 包一层。测试直接打 reducer：

```ts
import { describe, expect, it } from "vitest"
import { applyStreamEvent, mapHistoryMessage, type StreamMessage } from "./agentStream"

describe("applyStreamEvent", () => {
  it("assistant 首片 push isLoading，后续原地累加", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "你好" })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].isLoading).toBe(true)
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "，患者" })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe("你好，患者")
  })
  it("reasoning 独立累加；来 assistant 时 reasoning 不再续写", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, { messageType: "reasoning", content: "思考A" })
    msgs = applyStreamEvent(msgs, { messageType: "reasoning", content: "思考B" })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe("思考AB")
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "答" })
    msgs = applyStreamEvent(msgs, { messageType: "reasoning", content: "思考C" })
    // reasoning C 开新条目
    expect(msgs).toHaveLength(2)
    expect(msgs[1].type).toBe("reasoning")
  })
  it("tool-request 复位 assistant 累加并逐 toolCall push 卡片", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "部分回答" })
    msgs = applyStreamEvent(msgs, {
      messageType: "tool-request",
      content: "",
      toolCalls: [
        { name: "searchDocuments", arguments: '{"query":"青光眼"}' },
        { name: "bad", arguments: "{broken" },
      ],
    })
    expect(msgs).toHaveLength(3)
    expect(msgs[1].type).toBe("tool-request")
    expect(msgs[1].toolCalls?.[0].args).toEqual({ query: "青光眼" })
    expect(msgs[2].toolCalls?.[0].args).toEqual({ _raw: "{broken" })
    // assistant 重新累加
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "新回合" })
    expect(msgs[3].content).toBe("新回合")
  })
  it("tool-confirm/mcp-confirm 都映射为 confirm 信息卡", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, { messageType: "tool-confirm", content: "工具: x" })
    msgs = applyStreamEvent(msgs, { messageType: "mcp-confirm", content: "工具: y" })
    expect(msgs).toHaveLength(2)
    expect(msgs.every((m) => m.type === "confirm")).toBe(true)
  })
  it("tool-response push 卡片（含 toolName）", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, { messageType: "tool-response", content: "结果", toolName: "searchDocuments" })
    expect(msgs[0]).toMatchObject({ type: "tool-response", content: "结果", toolName: "searchDocuments" })
  })
})

describe("mapHistoryMessage", () => {
  it("role/subType 映射表", () => {
    const base = { id: 1, isSummary: false, createdTime: "2026-11-08 10:00:00" }
    expect(mapHistoryMessage({ ...base, role: "USER", subType: "", content: "问" }).type).toBe("user")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "reasoning", content: "想" }).type).toBe("reasoning")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "tool-call", content: "t: {}" }).type).toBe("tool-request")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "tool-result", content: "r" }).type).toBe("tool-response")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "mcp-confirm", content: "c" }).type).toBe("confirm")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "text", content: "答" }).type).toBe("assistant")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/agentStream.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `agentStream.ts`**

- 导出纯 reducer `applyStreamEvent(msgs: StreamMessage[], dto: AgentStreamDTO): StreamMessage[]`，逻辑与 `frontend/src/composables/useAgentStream.ts:118-197` 的 switch 一一对应（messageType 统一小写；assistant 累加用 `msgs` 尾部追踪——reducer 里用闭包外变量不可行，改为：assistant 累加目标 = 数组中最后一条 `type==="assistant" && isLoading` 的消息，若无则 push；reasoning 同理按最后一条 reasoning 且其后没有 assistant/tool 类消息来判定续写，实现方式：模块内 reducer 是纯函数，用「查找最后一个可续写条目」规则替代 Vue 版索引变量。tool-request/tool-response/tool-confirm 全部截断续写）。所有新消息 `id: crypto.randomUUID()`。
- `mapHistoryMessage(m: HistoryMessageVO): StreamMessage`：映射表见测试；`time: m.createdTime ? formatTime(m.createdTime) : ""`；`tool-call`/`tool-result` 的 toolName 取 `content.split(":")[0] || "工具"`（对齐 Vue 版 AgentChatPage.vue:192）。
- `useAgentStream()` hook：`useState<StreamMessage[]>` + `useState<boolean>` + `useState<AgentResources>`；`send()` 调 Task 1 `streamChat`，`onEvent` 里 `setMessages(prev => applyStreamEvent(prev, dto))`，同时 tool-response 时用 `extractResources` 累积资源（`setResources(prev => extractResources(dto.content, prev))`）；`onDone` 里把最后一条 assistant 的 `isLoading` 置 false；hook 内 `useRef<AbortController>`，组件卸载 `useEffect(() => () => abort(), [])`（StrictMode 双挂载安全：abort 未激活的 controller 是 no-op）。`pushUser`/`reset` 语义同 Vue 版。发送失败路径（streamChat throw）：把最后 assistant 的 isLoading 置 false，向上 rethrow 由页面 catch 做 commitFailure。
- 资源提取时机：Vue 版在 onclose 对最终 streamContent 二次提取——React 版简化为每次 tool-response 即时提取（已含去重），onDone 不再二次提取（避免重复正则三份问题的复现）。

- [ ] **Step 4: 跑测试确认通过 + typecheck + 提交**

Run: `cd web && npx vitest run src/lib/agentStream.test.ts && npm run typecheck`
Expected: PASS

```bash
git add web/src/lib/agentStream.ts web/src/lib/agentStream.test.ts
git commit -m "feat(web): agent SSE 流核心 hook 与事件 reducer"
```

### Task 4: 图片所有权账本

**Files:**
- Create: `web/src/lib/agentImageOwnership.ts`
- Test: `web/src/lib/agentImageOwnership.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `deleteAgentImage`
- Produces: `acquireAgentImage(url: string): void` / `retainAgentImage(url: string): void` / `releaseAgentImage(url: string): void`

- [ ] **Step 1: 写失败测试**

测试用 `vi.mock("./api", ...)` mock `deleteAgentImage`，覆盖：acquire 两次 release 一次不删、最后持有者 release 才删、retain 后永不删、同一 URL 重复删除只发一次请求、空串 no-op。用 `beforeEach` 重置模块（`vi.resetModules()` + 动态 import，因为账本是模块级 Map）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/agentImageOwnership.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现账本**

从 `frontend/src/composables/agentImageOwnership.ts` **逐行移植**（holders/retained/deleted 三态，注释一并带走，只改 import 路径为 `./api`）。

- [ ] **Step 4: 跑测试确认通过 + 提交**

Run: `cd web && npx vitest run src/lib/agentImageOwnership.test.ts`
Expected: PASS

```bash
git add web/src/lib/agentImageOwnership.ts web/src/lib/agentImageOwnership.test.ts
git commit -m "feat(web): agent 图片所有权引用计数账本"
```

### Task 5: 上传去重 + commit/rollback

**Files:**
- Create: `web/src/lib/agentUpload.ts`
- Test: `web/src/lib/agentUpload.test.ts`

**Interfaces:**
- Consumes: Task 1 `uploadAgentImage`；Task 4 `acquireAgentImage/releaseAgentImage/retainAgentImage`
- Produces: `useAgentUpload(): { uploadFiles(files: File[]): Promise<{urls: string[]}>; commitSuccess(urls: string[]): void; commitFailure(urls: string[]): void }`

- [ ] **Step 1: 写失败测试**

mock `uploadAgentImage`（可拒绝）与所有权层（spy acquire/release/retain——`vi.mock("./agentImageOwnership")`）。覆盖：正常上传返回 urls 且 acquire；同指纹并发合并请求（两次 uploadFiles 同一个 File 引用，mock 只调一次）；失败回滚本批次（Review Focus #5：第一个成功第二个失败 → 对第一个 release）；commitSuccess → retain；commitFailure → release。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/agentUpload.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

从 `frontend/src/composables/useAgentUpload.ts` 移植：`inFlight` 模块级 Map（key `${name}:${size}:${lastModified}`）、失败逐个 release、finally 清 inFlight。保留原注释。作为普通导出函数即可（Vue 版是 composable，React 版不需要 hook 化——无状态，直接 `export function useAgentUpload` 保持命名一致性或直接 `agentUpload`；**决定：导出普通函数 `export function useAgentUpload()` 无 hook 语义**，与 Interfaces 表一致）。

- [ ] **Step 4: 跑测试确认通过 + 提交**

Run: `cd web && npx vitest run src/lib/agentUpload.test.ts`
Expected: PASS

```bash
git add web/src/lib/agentUpload.ts web/src/lib/agentUpload.test.ts
git commit -m "feat(web): agent 图片上传去重与回滚"
```

### Task 6: 消息子组件 ×6

**Files:**
- Create: `web/src/components/agent/messages/UserMessage.tsx`
- Create: `web/src/components/agent/messages/AssistantMessage.tsx`
- Create: `web/src/components/agent/messages/ReasoningMessage.tsx`
- Create: `web/src/components/agent/messages/ToolRequestMessage.tsx`
- Create: `web/src/components/agent/messages/ToolResponseMessage.tsx`
- Create: `web/src/components/agent/messages/ConfirmMessage.tsx`
- Modify: `web/src/styles/agent.css`（新建文件，本任务起头）

**Interfaces:**
- Consumes: `StreamMessage`（Task 3）；`renderMarkdown`（Task 2）
- Produces: 六个具名导出组件，统一签名 `(props: { msg: StreamMessage }) => JSX.Element`。class 名约定：`.agent-msg--user/-assistant/-reasoning/-tool-request/-tool-response/-confirm`，内部结构沿用 `.trace` 体系（`.trace__role` 角色标 + `.trace__content`）。

- [ ] **Step 1: 新建 `web/src/styles/agent.css` 并在 `web/src/index.css` 追加 `@import "./styles/agent.css";`**

- [ ] **Step 2: 实现六个组件**

- **UserMessage**：右对齐，`msg.images` 渲染 48px 缩略图网格（最多 4 张 + "+N"），图片 `<img loading="lazy">`；无时间戳时**不显示时间**（修复 Vue 版「无 time 用当前时间」误导）。
- **AssistantMessage**：`dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}`；`msg.isLoading` 时内容尾追 `.caret-blink` 光标 span；复制按钮用 `navigator.clipboard.writeText` + 失败 alert 兜底（修复 Vue 版静默失败）；**不做** regenerate/share 按钮（Vue 版半成品不搬）。代码块复制用事件委托：组件根上监听 click，`closest(".copy-btn")` 时取 `data-code` 或相邻 code 文本复制。
- **ReasoningMessage**：`<details className="agent-msg--reasoning">` 原生折叠（零 JS），summary 是 mono overline「思考过程」，内容 renderMarkdown。
- **ToolRequestMessage**：沿用现有 `.trace__call`/`.trace__fields` dl 结构：每个 toolCall 一行工具名 mono + 参数表（`Object.entries(args)` 或 `_raw` 原串）。
- **ToolResponseMessage**：同体系；`content.length > 120` 时 `<details>` 折叠，summary 显示前 120 字符省略。
- **ConfirmMessage**：信息性终点卡（决策 #3）——无任何按钮。文案结构：overline「工具执行已暂停」+ content（后端已拼好「工具: x\n评估: y」逐行）+ 一行说明「如需继续，请直接发送下一条消息」。样式区别于工具卡（用 `--signal` 左边条）。

样式：本任务只写这六个组件所需的 agent.css 分节（`/* agent: 消息行 */`），trace 基础样式已在 app.css 不重写；`--dark` 语境类名沿用。markdown-body 内的 p/ul/code 等元素样式若 app.css 没有，在本文件补（`:is(.markdown-body) p {...}` 形式，只消费上下文令牌）。

- [ ] **Step 3: typecheck + 提交**

Run: `cd web && npm run typecheck`
Expected: PASS

```bash
git add web/src/components/agent/messages/ web/src/styles/agent.css web/src/index.css
git commit -m "feat(web): agent 消息子组件与样式基座"
```

### Task 7: MessageList + WelcomeScreen

**Files:**
- Create: `web/src/components/agent/WelcomeScreen.tsx`
- Create: `web/src/components/agent/MessageList.tsx`

**Interfaces:**
- Consumes: Task 6 六组件；`StreamMessage`（Task 3）；Task 2 的 markdown 无关
- Produces: `<MessageList messages loading streaming onSend(text: string) />`；`<WelcomeScreen onSend />`。`onSend` 供欢迎屏快捷提示直接发起提问。

- [ ] **Step 1: 实现 WelcomeScreen**

按「白色仪器」语言重写（Vue 版违规动画不搬）：`.is-field` 语境下，serif 大标题「眼科智能助手」+ 一段说明 + 3 个快捷提示卡（如「帮我解读这张眼底照片」「青光眼的早期症状有哪些」「用眼疲劳如何缓解」），点击卡片即 `onSend(问题文本)`。无粒子/无发光/无动画（AI 装饰零容忍）。样式节 `/* agent: 欢迎屏 */`。

- [ ] **Step 2: 实现 MessageList**

- 路由：`switch (msg.type)` → 六组件；`confirm` → ConfirmMessage。
- 消息为空且 `!loading` → 渲染 `<WelcomeScreen onSend />`。
- `streaming` 时尾部渲染打字指示（`.console__live` 呼吸点样式复用，放 `.trace` 行内角色位「AGENT」）。
- 滚动：容器 ref，`scrollHeight - scrollTop - clientHeight < 80` 视为贴底；贴底时新消息自动滚到底（`useEffect` on `messages.length` + 最后一条 content），不贴底显示「↓ N 条新消息」悬浮按钮（`N` 用未读计数 state）。AI 回复进行中的流式累加也要贴底跟随（依赖最后一条消息的 content）。
- 回合外层包 `.console` 反相带？**决定：MessageList 根是普通滚动容器 `.agent-msglist`（亮色语境），每条消息行用 `.trace` 骨架；`.console` 暗底整体包裹消息区，作为页面中带（与落地页 AgentConsole 同语）。** 即 `<div className="console agent-console"><div className="console__body agent-msglist">…trace 行…</div></div>`——视觉直接对齐落地页演示屏。

- [ ] **Step 3: typecheck + 提交**

Run: `cd web && npm run typecheck`
Expected: PASS

```bash
git add web/src/components/agent/MessageList.tsx web/src/components/agent/WelcomeScreen.tsx web/src/styles/agent.css
git commit -m "feat(web): agent 消息列表与欢迎屏"
```

### Task 8: ChatInput + ResourcePanel

**Files:**
- Create: `web/src/components/agent/ChatInput.tsx`
- Create: `web/src/components/agent/ResourcePanel.tsx`
- Modify: `web/src/styles/agent.css`

**Interfaces:**
- Consumes: 无新依赖（纯 UI）
- Produces: `<ChatInput disabled streaming onSend(text: string, files: File[]) onStop />`；`<ResourcePanel open resources onClose onPreviewImage(url: string) />`

- [ ] **Step 1: 实现 ChatInput**

- 自适应 textarea：`useRef` + `useEffect` on value，`style.height = "auto"; style.height = scrollHeight + "px"`，`maxHeight` 上限 ~160px。Enter 发送 / Shift+Enter 换行（isComposing 时 Enter 不发送——中文输入法必须处理，Vue 版没处理这是坑）。
- 粘贴图片：`onPaste` 里 `e.clipboardData.files` 非空时 append 进附件列表（`File[]` state + `URL.createObjectURL` 预览，卸载/发送后 revoke）。
- 附件条：缩略图 + 移除按钮。
- 右侧按钮：`streaming` 时显示「停止」（onStop），否则「发送」（disabled = (!text.trim() && files.length===0) || disabled）。样式节 `/* agent: 输入区 */`，沿用 `.console__input` 骨架改为亮色语境或定义 `.agent-input` 局部类（消费上下文令牌，双主题自动成立）。

- [ ] **Step 2: 实现 ResourcePanel**

- 右侧 340px 抽栏（非 overlay，桌面双栏；<900px 折为顶部收纳或隐藏——跟随 `.diag` 的断点惯例）：双 tab「图片 N / 链接 M」（本页 state 切换）。图片网格点击 → `onPreviewImage`（Task 9 实现预览弹层，本组件只 emit）。链接列表：title + domain（mono 小字）+ `<a target="_blank" rel="noreferrer">`。空态：mono 说明「本回合暂无资源」。关闭按钮。

- [ ] **Step 3: typecheck + 提交**

Run: `cd web && npm run typecheck`
Expected: PASS

```bash
git add web/src/components/agent/ChatInput.tsx web/src/components/agent/ResourcePanel.tsx web/src/styles/agent.css
git commit -m "feat(web): agent 输入区与资源面板"
```

### Task 9: SessionList

**Files:**
- Create: `web/src/components/agent/SessionList.tsx`
- Modify: `web/src/styles/agent.css`

**Interfaces:**
- Consumes: `AgentSessionVO`（Task 1）
- Produces: `<SessionList sessions: AgentSessionVO[] activeId: string busy: boolean onNewChat onSelect(id) onRename(id, title) onDelete(id) onBatchDelete(ids: string[]) onTogglePin(id, pinned) onExport(id) onCollapse />`。会话操作**全部上抛**给页面执行并刷新列表（修复 Vue 版列表不刷新 bug 的结构保证：组件自己不调 API）。

- [ ] **Step 1: 实现**

- 分组：pinned 置顶区 + 「今天 / 昨天 / 更早」按 `updatedTime` 分组（本地 `new Date(updatedTime)` 比较，跨天零点）。
- 行内重命名：点击行进入编辑态（`<input>` 受控），Enter/blur 提交 `onRename`，Esc 取消。
- 多选模式：checkbox 批量选择 → 底部操作条「删除 N 项」→ `onBatchDelete`。删除前用 `window.confirm`（项目无 Modal 组件先例，用原生确认即可，antd 不引入）。
- 每行悬浮菜单：重命名 / 置顶(切换) / 导出 / 删除。菜单用简单的展开行内按钮组（避免 Vue 版 Teleport 悬浮菜单复杂度）。
- 头部：「会话」overline + 新建按钮 + 折叠按钮（onCollapse）。样式节 `/* agent: 会话列表 */`。

- [ ] **Step 2: typecheck + 提交**

Run: `cd web && npm run typecheck`
Expected: PASS

```bash
git add web/src/components/agent/SessionList.tsx web/src/styles/agent.css
git commit -m "feat(web): agent 会话列表组件"
```

### Task 10: AgentPage 页面编排 + 路由验收

**Files:**
- Modify: `web/src/pages/AgentPage.tsx`（重写）
- Modify: `web/src/styles/agent.css`

**Interfaces:**
- Consumes: Task 3 `useAgentStream/mapHistoryMessage`、Task 5 `useAgentUpload`、Task 7–9 三组件、Task 1 全部 API、`useSession`（session.tsx）、`describeError`（api.ts）
- Produces: 完整可用的 `/agent` 页面

- [ ] **Step 1: 实现页面**

布局：`is-field` 页壳（SiteHeader/main.wrap/SiteFooter）→ 三栏 grid（左 260px 会话 / 中自适应 / 右 340px 资源，`resourceOpen` 时右栏占位，<900px 单栏）。沿用 `.diag` 的 grid 断点写法。

状态与逻辑（对标 `AgentChatPage.vue:108-334`，逐条对应）：
- `threadId`：`crypto.randomUUID()` 初始化；localStorage key `agent_current_thread_id`（load/save 同 Vue 版，含空串分叉防护注释 `AgentChatPage.vue:214-219`）；`sessionId`（= threadId，用于 currentThreadId 展示）。
- 挂载：并行 `getSessions()` + 有 savedThreadId 时 `getChatHistory(savedId, undefined, 100)` → `mapHistoryMessage` 塞进 messages（经 stream hook 的 reset + pushUser？**决定：MessageList 的 messages 直接用 useAgentStream 的 messages state，历史加载通过 `pushUser` 不可行——在 agentStream hook 里补一个 `setMessages(msgs: StreamMessage[])` 导出**（Task 3 补充导出，本任务用到则回 Task 3 加一行——执行时直接在 hook 里加，无需重开任务）。
- `handleSend(text, files)`：守卫（空内容/streaming 中 return）→ **先判 isFirstMessage**（`messages.length === 0`，pushUser 之前）→ files 走 uploadFiles（失败 toast return）→ pushUser → `send()` → 成功：commitSuccess + saveThreadId + generateTitle(首条时)+getSessions 刷新；失败：commitFailure + `describeError` 提示。
- `handleSelectHistory(id)`：设 id + save + reset + `getChatHistory(id, undefined, 100)` → `setMessages(mapped)`。加载中显示 loading 态。
- `handleNewChat`：save("")+ 清 currentThreadId + 新 threadId + reset。
- 删除/批量删除/置顶/重命名/导出：调 API → 成功后 `getSessions()` 刷新列表（修复 Vue 版 bug）；删除当前会话时走 handleNewChat 逻辑。导出：`exportSession(id, format)` 拿字符串 → Blob 下载（markdown/json 两项，format 菜单二选一或两个按钮）。
- 确认卡无操作（决策 #3）——ConfirmMessage 纯展示，页面不绑 confirm handler。
- 登录守卫：`useSession().status === "anon"` → 渲染 40100 引导（对齐 DiagnosisPage.tsx:368-371 模式，链接 `/login?redirect=/agent`）。
- 错误提示：不引 antd，用现有 `.notice` 类（app.css 已有）做行内提示条。

- [ ] **Step 2: 双主题 + 交互人工验收**

Run: `cd web && npm run dev`（后端 `mvn spring-boot:run` 需同时在跑）
人工检查：
- [ ] 亮色/暗房两主题下三栏布局、console 反相带、消息行可读
- [ ] 发消息收流式回复、打字光标、停止按钮中断
- [ ] 新建会话→发首条→列表出现新会话标题（generateTitle 异步刷新）
- [ ] 切换历史会话→消息正确映射渲染（含 mcp-confirm 存量数据）
- [ ] 重命名/置顶/删除/批量删除/导出 markdown
- [ ] 粘贴图片上传→发送→失败路径回滚（断网模拟）
- [ ] 未登录访问 /agent → 登录引导
- [ ] 中文输入法打字 Enter 不误发（isComposing）

- [ ] **Step 3: 生产构建验证**

Run: `cd web && npm run build`
Expected: PASS（tsc + vite build 无错误）

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/AgentPage.tsx web/src/styles/agent.css web/src/lib/agentStream.ts
git commit -m "feat(web): agent 对话页全功能装配"
```

---

## 附录：后端契约事实（调研确认）

- **SSE 端点** `POST /api/agent/chat/stream`：请求体 `{message, threadId?, imageUrls?, enabledMcpServers?, disableMcpDefault?}`（React 版只发前三个）；事件：默认 message 事件（data = MessageDTO JSON：`messageType`/`content`/`toolCalls[{name,arguments}]`）+ 终止 `event: done` + 错误 `event: error`。messageType 大小写：后端枚举序列化可能大写（`ASSISTANT`），**前端统一 toLowerCase**。
- **TOOL_CONFIRM 语义**（DiagnosisAgent.java:192-203）：`InterruptionMetadata` 图中断 → 推 tool-confirm → 流正常结束。无 confirm/resume 端点、无 checkpointer（AgentController.java 全文确认）。→ 信息卡决策的依据。
- **REST 端点**（均 `credentials: include`，信封 `{code:0,data,msg}`）：`GET /agent/history/{threadId}?beforeId&limit`、`GET /agent/sessions?beforeId&limit`、`DELETE /agent/sessions/{id}`、`DELETE /agent/sessions/batch`（body `{sessionIds}`）、`PUT /agent/sessions/{id}/title`（body `{title}`）、`PUT /agent/sessions/{id}/pin`（body `{pinned}`）、`POST /agent/sessions/{id}/generate-title`（body `{firstMessage}`）、`GET /agent/history/{id}/export?format=markdown|json`、`POST /agent/image/upload`（FormData `file` → data 为 URL 字符串）、`POST /agent/image/upload/delete`（body `{url}`）。
- **历史 subType 取值**：`reasoning` / `tool-call` / `tool-result` / `mcp-confirm` / `text`（ChatHistoryService.java:99 存的是 `mcp-confirm`）。

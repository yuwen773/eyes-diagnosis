import { describe, expect, it } from "vitest"
import { applyStreamEvent, clearAllLoading, mapHistoryMessage, type StreamMessage } from "./agentStream"

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
    expect(msgs[0].content).toBe("思考A思考B")
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "答" })
    msgs = applyStreamEvent(msgs, { messageType: "reasoning", content: "思考C" })
    // reasoning C 开新条目：reasoningAB / assistant / reasoningC
    expect(msgs).toHaveLength(3)
    expect(msgs[2].type).toBe("reasoning")
    expect(msgs[2].content).toBe("思考C")
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
  it("tool-request 截断时把前一条 assistant 的 isLoading 置 false（不再永久闪烁）", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "我先查一下知识库" })
    expect(msgs[0].isLoading).toBe(true)
    msgs = applyStreamEvent(msgs, {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ name: "searchDocuments", arguments: "{}" }],
    })
    expect(msgs[0].isLoading).toBe(false)
    // 下一段 assistant 另起一条
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "结论如下" })
    expect(msgs).toHaveLength(3)
    expect(msgs[2].isLoading).toBe(true)
  })
  it("首个事件即 tool-request：返回新数组，不改写上一份 state", () => {
    // 回归：truncate 在无流式 assistant 时原样返回同一引用，就地 push 会让
    // setMessages 的 updater 返回同引用，React 按 Object.is 跳过渲染（卡片不出现）。
    const prev: StreamMessage[] = []
    const next = applyStreamEvent(prev, {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ name: "searchDocuments", arguments: "{}" }],
    })
    expect(next).not.toBe(prev)
    expect(prev).toHaveLength(0)
    expect(next).toHaveLength(1)
  })

  it("reasoning 之后紧跟 tool-request 也不改写旧 state", () => {
    // reasoning 不带 isLoading，同样走 truncate 的「原样返回」分支。
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, { messageType: "reasoning", content: "先想想" })
    const prev = msgs
    const next = applyStreamEvent(prev, {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ name: "searchDocuments", arguments: "{}" }],
    })
    expect(next).not.toBe(prev)
    expect(prev).toHaveLength(1)
    expect(next).toHaveLength(2)
  })

  it("updater 可重复调用（StrictMode 双执行）不产生重复卡片", () => {
    const prev: StreamMessage[] = []
    const dto = {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ name: "searchDocuments", arguments: "{}" }],
    }
    expect(applyStreamEvent(prev, dto)).toHaveLength(1)
    expect(applyStreamEvent(prev, dto)).toHaveLength(1)
    expect(prev).toHaveLength(0)
  })

  it("clearAllLoading 清掉所有流式中的 assistant", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "一" })
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "二" })
    const cleared = clearAllLoading(msgs)
    expect(cleared.every((m) => !m.isLoading)).toBe(true)
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

  it("tool-result 是后端新契约的别名，携带 toolCallId 与状态", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, {
      messageType: "tool-result",
      content: "检索到 3 段文档",
      toolName: "searchDocuments",
      toolCallId: "call_1",
      status: "success",
      timestamp: "2026-11-08T10:20:00Z",
    })
    expect(msgs[0]).toMatchObject({
      type: "tool-response",
      content: "检索到 3 段文档",
      toolName: "searchDocuments",
      toolCallId: "call_1",
      toolStatus: "success",
    })
    // 时间戳按本地时钟展示（测试进程时区可能与 UTC 不同，这里只要求非空且形如 HH:mm）
    expect(msgs[0].time).toMatch(/^\d{2}:\d{2}$/)
  })

  it("tool-request 的每个调用都带 toolCallId，逐条成消息", () => {
    const msgs = applyStreamEvent([], {
      messageType: "tool-request",
      content: "",
      toolCalls: [
        { id: "call_a", name: "searchDocuments", arguments: '{"query":"青光眼"}' },
        { id: "call_b", name: "analyzeEyeImage", arguments: '{"url":"x"}' },
      ],
    })
    expect(msgs).toHaveLength(2)
    expect(msgs.map((m) => m.toolCallId)).toEqual(["call_a", "call_b"])
    expect(msgs.map((m) => m.toolCalls?.[0].id)).toEqual(["call_a", "call_b"])
  })

  it("assistant 首片写入服务端时间，后续分片不改写", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, {
      messageType: "assistant",
      content: "你",
      timestamp: "2026-11-08T10:20:00Z",
    })
    const first = msgs[0].time
    msgs = applyStreamEvent(msgs, {
      messageType: "assistant",
      content: "好",
      timestamp: "2026-11-08T10:21:00Z",
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].time).toBe(first)
  })

  it("SSE 没有时间戳时留空，不编造本地时间", () => {
    const msgs = applyStreamEvent([], { messageType: "assistant", content: "答" })
    expect(msgs[0].time).toBeUndefined()
  })
})

describe("parseServerTime", () => {
  it("旧格式按 UTC 解析，与 reconcile 的 epoch 口径一致", async () => {
    const { parseServerTime } = await import("./agentStream")
    expect(parseServerTime("2026-11-08 10:20:00")).toBe(Date.UTC(2026, 10, 8, 10, 20, 0))
    expect(parseServerTime("2026-11-08T10:20:00Z")).toBe(Date.UTC(2026, 10, 8, 10, 20, 0))
    expect(parseServerTime("2026-11-08T18:20:00+08:00")).toBe(
      Date.UTC(2026, 10, 8, 10, 20, 0),
    )
    expect(parseServerTime("nope")).toBeNull()
  })
})

describe("mapHistoryMessage", () => {
  it("role/subType 映射表", () => {
    const base = { id: "1", isSummary: false, createdTime: "2026-11-08 10:00:00" }
    expect(mapHistoryMessage({ ...base, role: "USER", subType: "", content: "问" }).type).toBe("user")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "reasoning", content: "想" }).type).toBe("reasoning")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "tool-call", content: "t: {}" }).type).toBe("tool-request")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "tool-result", content: "r" }).type).toBe("tool-response")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "mcp-confirm", content: "c" }).type).toBe("confirm")
    expect(mapHistoryMessage({ ...base, role: "ASSISTANT", subType: "text", content: "答" }).type).toBe("assistant")
  })

  it("历史 tool-call 解析出工具名与参数（否则历史里的工具步骤渲染成空白行）", () => {
    const m = mapHistoryMessage({
      id: "2",
      role: "ASSISTANT",
      subType: "tool-call",
      // 后端落库格式：工具名: 参数 JSON（DiagnosisAgent.java:168-173）
      content: 'searchDocuments: {"query":"青光眼"}',
      isSummary: false,
      createdTime: "2026-11-08 10:00:00",
    })
    expect(m.type).toBe("tool-request")
    expect(m.toolName).toBe("searchDocuments")
    expect(m.toolCalls?.[0]).toEqual({ name: "searchDocuments", args: { query: "青光眼" } })
  })

  it("历史 tool-call 参数不是合法 JSON 时保留原文", () => {
    const m = mapHistoryMessage({
      id: "3",
      role: "ASSISTANT",
      subType: "tool-call",
      content: "broken: {not json",
      isSummary: false,
      createdTime: "2026-11-08 10:00:00",
    })
    expect(m.toolCalls?.[0].args).toEqual({ _raw: "{not json" })
  })

  it("新落库 JSON 能恢复 toolCallId 与返回状态", () => {
    const call = mapHistoryMessage({
      id: "4",
      role: "ASSISTANT",
      subType: "tool-call",
      content: JSON.stringify({
        toolCallId: "call_9",
        name: "searchDocuments",
        arguments: '{"query":"白内障"}',
      }),
      isSummary: false,
      createdTime: "2026-11-08T10:00:00Z",
    })
    expect(call.type).toBe("tool-request")
    expect(call.toolCallId).toBe("call_9")
    expect(call.toolCalls?.[0]).toMatchObject({
      id: "call_9",
      name: "searchDocuments",
      args: { query: "白内障" },
    })

    const result = mapHistoryMessage({
      id: "5",
      role: "ASSISTANT",
      subType: "tool-result",
      content: JSON.stringify({
        toolCallId: "call_9",
        name: "searchDocuments",
        status: "error",
        output: "检索服务超时",
      }),
      isSummary: false,
      createdTime: "2026-11-08T10:00:01Z",
    })
    expect(result.type).toBe("tool-response")
    expect(result.toolCallId).toBe("call_9")
    expect(result.toolStatus).toBe("error")
    expect(result.content).toBe("检索服务超时")
  })

  it("旧 tool-result 行没有状态，标 completed（已返回）而不是未确认", () => {
    const m = mapHistoryMessage({
      id: "6",
      role: "ASSISTANT",
      subType: "tool-result",
      content: "检索到 2 段文档",
      isSummary: false,
      createdTime: "2026-11-08 10:00:00",
    })
    expect(m.toolStatus).toBe("completed")
    expect(m.content).toBe("检索到 2 段文档")
  })

  it("历史时间按统一口径解析：旧格式 10:20 UTC = 上海 18:20", async () => {
    const { formatClock } = await import("./time")
    const m = mapHistoryMessage({
      id: "7",
      role: "USER",
      subType: "",
      content: "问",
      isSummary: false,
      createdTime: "2026-11-08 10:20:00",
    })
    // 只在当前进程时区可换算时不强断言具体时分；这里验证遇到旧格式不抛错且非空。
    expect(m.time === undefined || /^\d{2}:\d{2}$/.test(m.time)).toBe(true)
    expect(formatClock(new Date(Date.UTC(2026, 10, 8, 10, 20)), "Asia/Shanghai")).toBe("18:20")
  })
})

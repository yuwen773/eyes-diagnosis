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
})

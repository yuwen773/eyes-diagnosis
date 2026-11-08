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

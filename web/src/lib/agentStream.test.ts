import { describe, expect, it } from "vitest"
import {
  applyStreamEvent,
  clearAllLoading,
  mapHistoryMessage,
  markPendingToolsCancelled,
  type StreamMessage,
} from "./agentStream"
import type { AgentStreamDTO } from "./api"

/** 一次真实工具调用的确定性夹具：请求 → running → 终态。 */
function toolRequest(id: string, name = "searchDocuments"): AgentStreamDTO {
  return {
    messageType: "tool-request",
    content: "",
    toolCalls: [
      { name, arguments: '{"query":"青光眼"}', id, stepLabel: "检索医学知识库" },
    ],
  }
}
function toolStatus(
  id: string,
  status: string,
  extra: Partial<AgentStreamDTO> = {},
): AgentStreamDTO {
  return {
    messageType: "tool-result",
    content: "",
    toolCallId: id,
    toolStatus: status,
    stepLabel: "检索医学知识库",
    ...extra,
  }
}

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

describe("工具执行状态契约 (A1)", () => {
  it("五个状态都能通过确定性事件序列重现，且只有 succeeded 带 STOP", () => {
    const states = [
      { wire: "awaiting-confirm", finishReason: undefined },
      { wire: "running", finishReason: undefined },
      { wire: "succeeded", finishReason: "STOP" },
      { wire: "failed", finishReason: "TOOL_ERROR" },
      { wire: "cancelled", finishReason: "INTERRUPTED" },
    ] as const
    for (const s of states) {
      let msgs: StreamMessage[] = []
      msgs = applyStreamEvent(msgs, toolRequest("call-1"))
      msgs = applyStreamEvent(msgs, toolStatus("call-1", s.wire, { finishReason: s.finishReason }))
      expect(msgs).toHaveLength(1)
      expect(msgs[0].toolStatus).toBe(s.wire)
      expect(msgs[0].finishReason).toBe(s.finishReason)
      expect(msgs[0].stepLabel).toBe("检索医学知识库")
    }
    // 只有真实成功结果才带 STOP
    const succeeded = applyStreamEvent(
      applyStreamEvent([], toolRequest("c")),
      toolStatus("c", "succeeded", { finishReason: "STOP" }),
    )
    expect(succeeded[0].finishReason).toBe("STOP")
  })

  it("并发工具卡按 toolCallId 归属，不串台", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, {
      messageType: "tool-request",
      toolCalls: [
        { name: "searchDocuments", arguments: "{}", id: "a", stepLabel: "检索医学知识库" },
        { name: "analyzeEyeImage", arguments: "{}", id: "b", stepLabel: "分析眼底图像" },
      ],
    })
    expect(msgs).toHaveLength(2)
    // b 先成功，a 后失败：状态必须落在各自的卡上
    msgs = applyStreamEvent(msgs, toolStatus("b", "succeeded", { finishReason: "STOP" }))
    expect(msgs[0].toolStatus).toBe("running")
    expect(msgs[1].toolStatus).toBe("succeeded")
    msgs = applyStreamEvent(msgs, toolStatus("a", "failed", { finishReason: "TOOL_ERROR", errorCategory: "TOOL_EXCEPTION" }))
    expect(msgs[0].toolStatus).toBe("failed")
    expect(msgs[0].errorCategory).toBe("TOOL_EXCEPTION")
    expect(msgs[1].toolStatus).toBe("succeeded")
    expect(msgs[1].finishReason).toBe("STOP")
    // 状态增量不新增卡片
    expect(msgs).toHaveLength(2)
  })

  it("普通 assistant 文本与 TOOL_REQUEST 本身都不会推断成功", () => {
    let msgs: StreamMessage[] = []
    msgs = applyStreamEvent(msgs, toolRequest("call-1"))
    expect(msgs[0].toolStatus).toBe("running")
    msgs = applyStreamEvent(msgs, { messageType: "assistant", content: "已经查到了" })
    expect(msgs[0].toolStatus).toBe("running")
    expect(msgs[0].finishReason).toBeUndefined()
    msgs = applyStreamEvent(msgs, { messageType: "tool-request", toolCalls: [{ name: "x", arguments: "{}", id: "call-2" }] })
    // 顺序：tool-request(a) / assistant / tool-request(b)
    expect(msgs[2].toolStatus).toBe("running")
    expect(msgs[2].finishReason).toBeUndefined()
    expect(msgs[1].content).toBe("已经查到了")
  })

  it("断流 / 错误 / 取消：markPendingToolsCancelled 不产生虚假成功", () => {
    const base = applyStreamEvent(
      applyStreamEvent([], toolRequest("a")),
      toolStatus("a", "succeeded", { finishReason: "STOP" }),
    )
    let msgs = applyStreamEvent(base, {
      messageType: "tool-request",
      toolCalls: [{ name: "x", arguments: "{}", id: "b" }],
    })
    msgs = markPendingToolsCancelled(msgs)
    expect(msgs[0].toolStatus).toBe("succeeded") // 已有真实结果不动
    expect(msgs[1].toolStatus).toBe("cancelled")
    expect(msgs[1].finishReason).toBe("INTERRUPTED")
    // 幂等：重复收尾不会把已取消的卡再改一遍
    expect(markPendingToolsCancelled(msgs)).toBe(msgs)
  })

  it("tool-confirm 带 AWAITING_CONFIRM 且保留 toolCallId", () => {
    const msgs = applyStreamEvent([], {
      messageType: "tool-confirm",
      content: "工具: x",
      toolCallId: "call-9",
      toolStatus: "awaiting-confirm",
      stepLabel: "调用工具",
    })
    expect(msgs[0]).toMatchObject({
      type: "confirm",
      toolStatus: "awaiting-confirm",
      toolCallId: "call-9",
    })
  })

  it("历史兼容：无状态字段的 tool-result 仍是独立结果卡", () => {
    const msgs = applyStreamEvent([], {
      messageType: "tool-result",
      content: "旧格式结果",
      toolName: "searchDocuments",
    })
    expect(msgs[0].type).toBe("tool-response")
    expect(msgs[0].toolStatus).toBeUndefined()
  })

  it("异常状态值不落卡；状态事件先到时补匿名卡且不推断成功", () => {
    const orphan = applyStreamEvent([], toolStatus("no-card", "succeeded", { finishReason: "STOP" }))
    expect(orphan).toHaveLength(1)
    expect(orphan[0].toolStatus).toBe("succeeded")
    expect(orphan[0].toolCallId).toBe("no-card")
    const bad = applyStreamEvent([], toolStatus("x", "MODEL_SAYS_DONE"))
    expect(bad).toHaveLength(0) // 无合法状态、无内容 → 不产生任何卡
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

  it("历史 tool-call 解析出工具名与参数（否则历史里的工具步骤渲染成空白行）", () => {
    const m = mapHistoryMessage({
      id: 2,
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
      id: 3,
      role: "ASSISTANT",
      subType: "tool-call",
      content: "broken: {not json",
      isSummary: false,
      createdTime: "2026-11-08 10:00:00",
    })
    expect(m.toolCalls?.[0].args).toEqual({ _raw: "{not json" })
  })
})

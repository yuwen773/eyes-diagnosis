import { describe, expect, it } from "vitest"
import { applyStreamEvent, mapHistoryMessage } from "./agentStream"
import { stateFromToolResult } from "./agentSteps"

describe("terminal wire and history agreement", () => {
  it.each(["TIMEOUT", "CANCELLED", "TOOL_EXCEPTION", "INVALID_OUTPUT"])(
    "%s survives the real-time DTO mapping and history reload", (category) => {
      const payload = { toolCallId: "call", toolName: "searchDocuments", toolStatus: "failed",
        errorCategory: category, content: "" }
      const realtime = applyStreamEvent([], { messageType: "tool-result", ...payload })[0]
      const history = mapHistoryMessage({ id: "1", role: "ASSISTANT", subType: "tool-result",
        content: JSON.stringify({ toolCallId: "call", name: "searchDocuments", status: "failed",
          errorCategory: category, output: "" }), isSummary: false, createdTime: "2026-11-19T00:00:00Z" })
      expect(realtime.errorCategory).toBe(category)
      expect(stateFromToolResult(realtime.toolStatus, realtime.errorCategory)).toBe(
        stateFromToolResult(history.toolStatus, history.errorCategory))
    },
  )
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { applyStreamEvent, mapHistoryMessage } from "@/lib/agentStream"
import { buildThread } from "@/lib/agentSteps"
import { ThoughtLine } from "./ThoughtLine"

afterEach(cleanup)

describe("real-time and replay terminal rendering", () => {
  it.each([
    ["TIMEOUT", /工具执行超时/],
    ["CANCELLED", /取消|中断/],
    ["INVALID_OUTPUT", /工具返回的内容不可用/],
    ["TOOL_EXCEPTION", /失败/],
  ] as const)("%s renders the same explanation before and after reload", (category, note) => {
    const live = applyStreamEvent([], { messageType: "tool-result", toolCallId: "tool-1",
      toolName: "searchDocuments", toolStatus: "failed", errorCategory: category, content: "" })
    const replay = [mapHistoryMessage({ id: "1", role: "ASSISTANT", subType: "tool-result",
      content: JSON.stringify({ toolCallId: "tool-1", name: "searchDocuments", status: "failed",
        errorCategory: category, output: "" }), createdTime: "2026-11-19T00:00:00Z", isSummary: false })]
    for (const messages of [live, replay]) {
      const process = buildThread(messages, false).find((item) => item.type === "process")
      if (!process || process.type !== "process") throw new Error("missing real reducer process")
      render(<ThoughtLine steps={process.steps} />)
      fireEvent.click(screen.getByRole("button", { name: /searchDocuments/ }))
      expect(screen.getAllByText(note).length).toBeGreaterThan(0)
      expect(screen.queryByText("工具返回了空结果。")).toBeNull()
      cleanup()
    }
  })
})

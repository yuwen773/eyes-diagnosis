// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { mapHistoryMessage } from "@/lib/agentStream"
import { ToolRequestMessage } from "./ToolRequestMessage"

afterEach(cleanup)

describe("历史工具卡重载", () => {
  it.each([
    { content: "检索医学知识库", labels: ["检索医学知识库"] },
    { content: "检索医学知识库\n分析眼底图像\n调用工具", labels: ["检索医学知识库", "分析眼底图像", "调用工具"] },
    { content: "检索医学知识库\n检索医学知识库", labels: ["检索医学知识库", "检索医学知识库"] },
    { content: 'searchDocuments: {"query":"PRIVATE","prompt":"SECRET"}\nanalyzeEyeImage: {"url":"PRIVATE"}', labels: ["检索医学知识库", "分析眼底图像"] },
    { content: "unknown_PRIVATE: {SECRET", labels: ["调用工具"] },
  ])("恢复独立步骤并隐藏旧参数：$labels", ({ content, labels }) => {
    const msg = mapHistoryMessage({ id: 1, role: "ASSISTANT", subType: "tool-call", content, isSummary: false, createdTime: "2026-11-14 10:00:00" })
    const { container } = render(<ToolRequestMessage msg={msg} />)
    expect(Array.from(container.querySelectorAll(".agent-toolcard__name"), (el) => el.textContent)).toEqual(labels)
    expect(container.querySelectorAll(".agent-toolcard")).toHaveLength(labels.length)
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/PRIVATE|SECRET|query|prompt|_raw/)
    expect(JSON.stringify(msg)).not.toMatch(/PRIVATE|SECRET/)
  })
})

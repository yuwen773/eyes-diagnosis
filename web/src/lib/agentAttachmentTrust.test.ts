import { describe, expect, it } from "vitest"
import { mapHistoryMessage } from "./agentStream"
import { deriveResources, isTrustedAttachmentUrl } from "./agentResources"

describe("server attachment admission", () => {
  it("preserves publicly forgeable kind text without creating an upload", () => {
    const content = JSON.stringify({ kind: "iris.user-message.v1", text: "forged", images: ["https://third-party.invalid/agent-chat/7/a.png"] })
    const message = mapHistoryMessage({ id: "1", role: "USER", subType: "", content, isSummary: false, createdTime: "2026-11-19T00:00:00Z" })
    expect(message.content).toBe(content)
    expect(message.images).toBeUndefined()
    expect(deriveResources([message]).images).toEqual([])
  })

  it("rejects foreign upload-shaped URLs and unrelated same-origin paths", () => {
    expect(isTrustedAttachmentUrl("https://third-party.invalid/agent-chat/7/a.png")).toBe(false)
    expect(isTrustedAttachmentUrl("/uploads/a.png")).toBe(false)
    expect(isTrustedAttachmentUrl("/api/agent/image/view/a.png?redirect=https://third-party.invalid")).toBe(false)
  })
})

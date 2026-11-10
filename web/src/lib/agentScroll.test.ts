import { describe, expect, it } from "vitest"
import { computeUnread } from "./agentScroll"

describe("computeUnread", () => {
  it("贴底时清零", () => {
    expect(computeUnread(3, { atBottom: true, isNewMessage: true, isContentGrowth: false })).toBe(0)
  })

  it("不在底部且是新消息才累加", () => {
    expect(computeUnread(0, { atBottom: false, isNewMessage: true, isContentGrowth: false })).toBe(1)
    expect(computeUnread(2, { atBottom: false, isNewMessage: true, isContentGrowth: false })).toBe(3)
  })

  it("流式内容增长不累加（一条 200 token 的回复只算一条）", () => {
    let unread = 0
    for (let i = 0; i < 200; i++) {
      unread = computeUnread(unread, {
        atBottom: false,
        isNewMessage: false,
        isContentGrowth: true,
      })
    }
    expect(unread).toBe(0)
  })

  it("不在底部且既非新消息也非内容增长时保持不变", () => {
    expect(computeUnread(4, { atBottom: false, isNewMessage: false, isContentGrowth: false })).toBe(4)
  })
})

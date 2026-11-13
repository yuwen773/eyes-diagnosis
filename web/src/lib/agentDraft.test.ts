// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { clearDraft, loadDraft, saveDraft } from "./agentDraft"

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  sessionStorage.clear()
})

describe("agentDraft", () => {
  it("存取草稿", () => {
    saveDraft("我眼底有点模糊")
    expect(loadDraft()).toBe("我眼底有点模糊")
  })

  it("清空草稿", () => {
    saveDraft("abc")
    clearDraft()
    expect(loadDraft()).toBe("")
  })

  it("空文本等于清掉草稿", () => {
    saveDraft("abc")
    saveDraft("")
    expect(loadDraft()).toBe("")
  })

  it("没有草稿时返回空串", () => {
    expect(loadDraft()).toBe("")
  })
})

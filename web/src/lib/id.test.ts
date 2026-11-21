import { afterEach, describe, expect, it, vi } from "vitest"

import { newId } from "./id"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("newId", () => {
  it("安全上下文下用 randomUUID", () => {
    const randomUUID = vi.fn(() => "11111111-2222-3333-4444-555555555555")
    vi.stubGlobal("crypto", { randomUUID })

    expect(newId()).toBe("11111111-2222-3333-4444-555555555555")
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })

  it("非安全上下文（没有 randomUUID）不抛错，仍给出唯一 id", () => {
    vi.stubGlobal("crypto", {})

    const first = newId()
    const second = newId()

    expect(first).toMatch(/^\d+-[a-z0-9]+$/)
    expect(second).not.toBe(first)
  })

  it("完全没有 crypto 也能用", () => {
    vi.stubGlobal("crypto", undefined)
    expect(newId()).toMatch(/^\d+-[a-z0-9]+$/)
  })
})

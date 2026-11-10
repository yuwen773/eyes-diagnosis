// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useMediaQuery } from "@/lib/useMediaQuery"

type Listener = (event: MediaQueryListEvent) => void

function mockMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const media = {
    matches: initial,
    media: "",
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  }
  window.matchMedia = (() => media) as unknown as typeof window.matchMedia
  return {
    change(next: boolean) {
      media.matches = next
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent))
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("useMediaQuery", () => {
  it("挂载时返回当前匹配结果", () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery("(max-width: 860px)"))
    expect(result.current).toBe(true)
  })

  it("媒体查询变化时跟着更新", () => {
    const media = mockMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery("(max-width: 860px)"))
    expect(result.current).toBe(false)

    act(() => media.change(true))
    expect(result.current).toBe(true)
  })
})

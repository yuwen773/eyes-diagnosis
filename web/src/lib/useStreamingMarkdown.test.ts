// @vitest-environment jsdom
import { StrictMode } from "react"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderMarkdown } from "./markdown"
import { useStreamingMarkdown } from "./useStreamingMarkdown"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useStreamingMarkdown", () => {
  it("流式期间按 60ms 合帧，不是每来一片就渲染", () => {
    const { result, rerender } = renderHook(
      ({ content, streaming }: { content: string; streaming: boolean }) =>
        useStreamingMarkdown(content, streaming),
      { initialProps: { content: "## 标", streaming: true } },
    )
    expect(result.current).toContain("<h2")

    rerender({ content: "## 标题\n\n第一段", streaming: true })
    // 还没到帧点：仍是上一帧的 HTML
    expect(result.current).not.toContain("第一段")

    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(result.current).toContain("第一段")
  })

  it("多次更新只落最后一帧", () => {
    const { result, rerender } = renderHook(
      ({ content, streaming }: { content: string; streaming: boolean }) =>
        useStreamingMarkdown(content, streaming),
      { initialProps: { content: "一", streaming: true } },
    )
    rerender({ content: "一 二", streaming: true })
    rerender({ content: "一 二 三", streaming: true })
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(result.current).toContain("一 二 三")
  })

  it("流结束立刻整篇渲染收口，不等下一个帧点", () => {
    const content = "## 结论\n\n**建议复查**。\n\n- 视力\n- 眼压"
    const { result, rerender } = renderHook(
      ({ content, streaming }: { content: string; streaming: boolean }) =>
        useStreamingMarkdown(content, streaming),
      { initialProps: { content: "## 结论", streaming: true } },
    )
    rerender({ content, streaming: false })
    expect(result.current).toBe(renderMarkdown(content))
  })

  it("收口后同一内容重复渲染不再变化", () => {
    const { result, rerender } = renderHook(
      ({ content, streaming }: { content: string; streaming: boolean }) =>
        useStreamingMarkdown(content, streaming),
      { initialProps: { content: "答", streaming: true } },
    )
    rerender({ content: "答案", streaming: false })
    const first = result.current
    rerender({ content: "答案", streaming: false })
    expect(result.current).toBe(first)
  })

  it("StrictMode 的「卸载→重挂载」之后仍会继续合帧", () => {
    // 回归：cleanup 只 clearTimeout 不把 ref 置空时，重挂载后的守卫以为
    // 还排着帧，之后再也不会渲染任何一片——开发模式下正文会停在第一帧。
    const { result, rerender } = renderHook(
      ({ content, streaming }: { content: string; streaming: boolean }) =>
        useStreamingMarkdown(content, streaming),
      { initialProps: { content: "一", streaming: true }, wrapper: StrictMode },
    )
    rerender({ content: "一二", streaming: true })
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(result.current).toContain("一二")
  })

  it("空内容返回空串", () => {
    const { result } = renderHook(() => useStreamingMarkdown("", true))
    expect(result.current).toBe("")
  })
})

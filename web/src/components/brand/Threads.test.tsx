// @vitest-environment jsdom
import { StrictMode } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import Threads from "./Threads"
import {
  installFakeWebgl2,
  installIntersectionHarness,
  installMatchMedia,
  installRafHarness,
} from "../../test/webglHarness"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Threads 生命周期", () => {
  it("StrictMode 假卸载只回收 GL 资源，不丢上下文", () => {
    const { loseContext, stats } = installFakeWebgl2()
    installRafHarness()

    const view = render(
      <StrictMode>
        <Threads />
      </StrictMode>,
    )

    // 挂载 → 假卸载 → 再挂载：每次挂载建两个程序（纤维带 + 合成）。
    expect(stats.programs).toBe(4)
    expect(stats.deletedPrograms).toBe(2)
    expect(stats.deletedTextures).toBe(1)
    expect(stats.deletedVertexArrays).toBe(2)
    expect(loseContext).not.toHaveBeenCalled()
    expect(view.container.querySelector("canvas")?.isConnected).toBe(true)

    view.unmount()

    expect(stats.deletedPrograms).toBe(4)
    expect(stats.deletedTextures).toBe(2)
    expect(stats.deletedVertexArrays).toBe(4)
    expect(loseContext).not.toHaveBeenCalled()
  })

  it("WebGL2 不可用时通知调用方切静态画面", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null)
    const onUnavailable = vi.fn()

    render(<Threads onUnavailable={onUnavailable} />)

    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it("webglcontextlost 通知调用方切静态降级", () => {
    installFakeWebgl2()
    installRafHarness()
    const onUnavailable = vi.fn()

    const { container } = render(<Threads onUnavailable={onUnavailable} />)
    const canvas = container.querySelector("canvas")
    expect(canvas).not.toBeNull()

    act(() => {
      canvas!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))
    })

    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it("离屏时停止排帧，回到视口后恢复", () => {
    const { stats } = installFakeWebgl2()
    const raf = installRafHarness()
    const intersection = installIntersectionHarness()

    render(<Threads />)

    expect(raf.pending()).toBe(1)
    raf.flush()
    expect(raf.pending()).toBe(1)

    intersection.emit(false)
    raf.flush()
    expect(raf.pending()).toBe(0)

    const drawsWhileOffscreen = stats.draws
    raf.flush()
    expect(stats.draws).toBe(drawsWhileOffscreen)

    intersection.emit(true)
    expect(raf.pending()).toBe(1)
    raf.flush()
    expect(raf.pending()).toBe(1)
    expect(stats.draws).toBeGreaterThan(drawsWhileOffscreen)
  })

  it("运行中打开「减少动态效果」会停帧，关闭后恢复", () => {
    installFakeWebgl2()
    const raf = installRafHarness()
    const media = installMatchMedia(false)

    render(<Threads />)
    raf.flush()
    expect(raf.pending()).toBe(1)

    media.set(true)
    raf.flush()
    expect(raf.pending()).toBe(0)

    media.set(false)
    expect(raf.pending()).toBe(1)
    raf.flush()
    expect(raf.pending()).toBe(1)
  })
})

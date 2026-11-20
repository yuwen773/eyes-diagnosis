// @vitest-environment jsdom
import { StrictMode } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import Prism from "./Prism"
import {
  installFakeWebgl2,
  installIntersectionHarness,
  installMatchMedia,
  installRafHarness,
  installVisibilityHarness,
} from "../../test/webglHarness"

let restoreVisibility: (() => void) | null = null

afterEach(() => {
  cleanup()
  restoreVisibility?.()
  restoreVisibility = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Prism 生命周期", () => {
  it("StrictMode 假卸载只回收 GL 资源，不丢上下文；真正卸载后才释放上下文", async () => {
    const { loseContext, stats } = installFakeWebgl2()
    const raf = installRafHarness()

    const view = render(
      <StrictMode>
        <Prism colors={["#2457c9", "#006f82"]} />
      </StrictMode>,
    )

    // 挂载 → 假卸载 → 再挂载：程序建了两次，第一次的资源已回收。
    expect(stats.programs).toBe(2)
    expect(stats.deletedPrograms).toBe(1)
    expect(stats.deletedTextures).toBe(1)
    expect(stats.deletedVertexArrays).toBe(1)
    // 假卸载时 canvas 仍在文档里，不能丢上下文。
    expect(loseContext).not.toHaveBeenCalled()
    expect(view.container.querySelector("canvas")?.isConnected).toBe(true)
    expect(raf.pending()).toBe(1)

    view.unmount()

    // 真卸载：第二套资源回收，且 canvas 离开文档后才丢上下文。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(stats.deletedPrograms).toBe(2)
    expect(stats.deletedTextures).toBe(2)
    expect(stats.deletedVertexArrays).toBe(2)
    expect(loseContext).toHaveBeenCalledTimes(1)
    expect(raf.cancel).toHaveBeenCalled()
  })

  it("webglcontextlost 通知调用方切静态降级", () => {
    installFakeWebgl2()
    installRafHarness()
    const onUnavailable = vi.fn()

    const { container } = render(<Prism onUnavailable={onUnavailable} />)
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

    render(<Prism />)

    // 旋转动画会持续排帧。
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

  it("后台标签页停止排帧，回到前台恢复", () => {
    installFakeWebgl2()
    const raf = installRafHarness()
    const visibility = installVisibilityHarness()
    restoreVisibility = visibility.restore

    render(<Prism />)
    raf.flush()
    expect(raf.pending()).toBe(1)

    visibility.set(true)
    raf.flush()
    expect(raf.pending()).toBe(0)

    visibility.set(false)
    expect(raf.pending()).toBe(1)
    raf.flush()
    expect(raf.pending()).toBe(1)
  })

  it("运行中打开「减少动态效果」会停帧，关闭后恢复", () => {
    installFakeWebgl2()
    const raf = installRafHarness()
    const media = installMatchMedia(false)

    render(<Prism />)
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

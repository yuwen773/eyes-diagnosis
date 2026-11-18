// @vitest-environment jsdom
import { StrictMode } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** 引擎是纯 WebGL 的，jsdom 里跑不了：这里只验挂载/卸载的契约。 */
const beams = vi.hoisted(() => ({ mountBeams: vi.fn() }))
vi.mock("./beamsMount", () => ({ mountBeams: beams.mountBeams }))

import { OpticFlow } from "./OpticFlow"

type Engine = { wake: () => void; dispose: () => void }

function engine(): Engine {
  return { wake: vi.fn(), dispose: vi.fn() }
}

/** 每次挂载都返回一台新引擎，调用方拿得到它们，好断言谁被 dispose 了。 */
function mountReturns(...engines: Engine[]) {
  let index = 0
  beams.mountBeams.mockImplementation(() => engines[Math.min(index++, engines.length - 1)])
}

beforeEach(() => {
  beams.mountBeams.mockReset()
})

const originalMatchMedia = window.matchMedia

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.matchMedia = originalMatchMedia
})

describe("OpticFlow 与 React StrictMode", () => {
  it("StrictMode 的假卸载之后还能再挂上：第二次挂载照常拿到引擎", () => {
    const first = engine()
    const second = engine()
    mountReturns(first, second)

    const { container, unmount } = render(
      <StrictMode>
        <OpticFlow theme="light" />
      </StrictMode>,
    )

    // 挂载 → 卸载 → 再挂载：引擎建了两次，第一个被回收。
    expect(beams.mountBeams).toHaveBeenCalledTimes(2)
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).not.toHaveBeenCalled()

    // 画面仍然是活的，没有因为第一次 dispose 掉进静态降级。
    const root = container.querySelector(".optic-flow") as HTMLElement
    expect(root.dataset.mode).toBe("live")
    expect(container.querySelector("canvas")).not.toBeNull()
    expect(container.querySelector(".optic-flow__fallback")).toBeNull()

    unmount()
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })

  it("卸载时把引擎一起回收", () => {
    const only = engine()
    mountReturns(only)

    const { unmount } = render(<OpticFlow theme="light" />)
    expect(only.dispose).not.toHaveBeenCalled()

    unmount()
    expect(only.dispose).toHaveBeenCalledTimes(1)
  })

  it("主题切换与手动暂停只是叫醒引擎，不重建它", () => {
    const only = engine()
    mountReturns(only)

    const { rerender, container } = render(<OpticFlow theme="light" />)
    const root = () => container.querySelector(".optic-flow") as HTMLElement

    rerender(<OpticFlow theme="dark" />)
    expect(root().dataset.theme).toBe("dark")
    expect(only.wake).toHaveBeenCalledTimes(1)

    rerender(<OpticFlow theme="dark" paused />)
    expect(root().dataset.mode).toBe("paused")
    expect(only.wake).toHaveBeenCalledTimes(2)

    // 全程只建过一次引擎：换主题不是重挂。
    expect(beams.mountBeams).toHaveBeenCalledTimes(1)
    expect(only.dispose).not.toHaveBeenCalled()
  })

  it("上下文丢失：切静态光带，并把引擎回收掉", () => {
    const only = engine()
    mountReturns(only)

    const { container } = render(<OpticFlow theme="light" />)
    const onContextLost = beams.mountBeams.mock.calls[0][0].onContextLost as () => void

    act(() => onContextLost())

    const root = container.querySelector(".optic-flow") as HTMLElement
    expect(root.dataset.mode).toBe("static")
    expect(container.querySelector(".optic-flow__fallback")).not.toBeNull()
    expect(container.querySelector("canvas")).toBeNull()
    // 静态画面不需要后台还在跑一个引擎。
    expect(only.dispose).toHaveBeenCalledTimes(1)
    // 降级之后不再重新挂载引擎。
    expect(beams.mountBeams).toHaveBeenCalledTimes(1)
  })

  it("引擎拿不到（WebGL2 不可用）时直接静态降级", () => {
    beams.mountBeams.mockReturnValue(null)

    const { container } = render(<OpticFlow theme="dark" />)

    const root = container.querySelector(".optic-flow") as HTMLElement
    expect(root.dataset.mode).toBe("static")
    expect(container.querySelector(".optic-flow__fallback")).not.toBeNull()
  })

  it("系统在运行中打开「减少动态效果」，画面当场转成暂停态", () => {
    const only = engine()
    mountReturns(only)

    const media = installMatchMedia(false)
    const { container } = render(<OpticFlow theme="light" />)
    const root = () => container.querySelector(".optic-flow") as HTMLElement

    expect(root().dataset.mode).toBe("live")
    expect(container.querySelector(".optic-flow__fibers")?.classList).toContain("is-drifting")

    act(() => media.set(true))

    expect(root().dataset.mode).toBe("paused")
    expect(container.querySelector(".optic-flow__fibers")?.classList).not.toContain("is-drifting")

    act(() => media.set(false))
    expect(root().dataset.mode).toBe("live")
  })
})

/** 可控的 matchMedia：能翻转 matches 并触发 change 监听。 */
function installMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  const state = { matches: initial }

  window.matchMedia = ((query: string) => ({
    get matches() {
      return state.matches
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia

  return {
    set(next: boolean) {
      state.matches = next
      listeners.forEach((listener) => listener())
    },
  }
}

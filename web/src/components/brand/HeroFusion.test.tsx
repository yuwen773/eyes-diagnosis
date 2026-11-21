// @vitest-environment jsdom
import { StrictMode } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** 引擎是纯 WebGL 的，jsdom 里跑不了：这里只验挂载/卸载与降级的契约。 */
const beams = vi.hoisted(() => ({ mountBeams: vi.fn() }))
vi.mock("./beamsMount", () => ({ mountBeams: beams.mountBeams }))

import { HeroFusion } from "./HeroFusion"

type Engine = {
  wake: () => void
  freeze: () => void
  thaw: () => void
  repaint: () => void
  dispose: () => void
}

function engine(): Engine {
  return {
    wake: vi.fn(),
    freeze: vi.fn(),
    thaw: vi.fn(),
    repaint: vi.fn(),
    dispose: vi.fn(),
  }
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

/** 可控的 `document.hidden`：翻转后补一个 visibilitychange 事件。 */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  })
  document.dispatchEvent(new Event("visibilitychange"))
}

afterEach(() => {
  cleanup()
  // 撤销 setHidden 的实例级 getter，恢复原型上的原始实现。
  delete (document as unknown as Record<string, unknown>).hidden
  delete (document as unknown as Record<string, unknown>).visibilityState
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.matchMedia = originalMatchMedia
})

describe("HeroFusion 与 React StrictMode", () => {
  it("StrictMode 的假卸载之后还能再挂上：第二次挂载照常拿到引擎", () => {
    const first = engine()
    const second = engine()
    mountReturns(first, second)

    const { container, unmount } = render(
      <StrictMode>
        <HeroFusion theme="light" />
      </StrictMode>,
    )

    expect(beams.mountBeams).toHaveBeenCalledTimes(2)
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).not.toHaveBeenCalled()

    const root = container.querySelector(".hero-fusion") as HTMLElement
    expect(root.dataset.mode).toBe("live")
    expect(container.querySelector("canvas")).not.toBeNull()
    // SVG 光学层始终在：它不依赖 WebGL。
    expect(container.querySelector(".hero-fusion__optics")).not.toBeNull()
    expect(container.querySelector(".hero-fusion__prism")).not.toBeNull()

    unmount()
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })

  it("卸载时把引擎一起回收", () => {
    const only = engine()
    mountReturns(only)

    const { unmount } = render(<HeroFusion theme="light" />)
    expect(only.dispose).not.toHaveBeenCalled()

    unmount()
    expect(only.dispose).toHaveBeenCalledTimes(1)
  })

  it("主题切换只是叫醒引擎，不重建它；暂停改成定格", () => {
    const only = engine()
    mountReturns(only)

    const { rerender, container } = render(<HeroFusion theme="light" />)
    const root = () => container.querySelector(".hero-fusion") as HTMLElement

    rerender(<HeroFusion theme="dark" />)
    expect(root().dataset.theme).toBe("dark")
    expect(only.wake).toHaveBeenCalledTimes(1)
    expect(only.freeze).not.toHaveBeenCalled()

    rerender(<HeroFusion theme="dark" paused />)
    expect(root().dataset.mode).toBe("paused")
    // 暂停 = 定格：停 rAF 并保留最后一帧，而不是只停状态推进。
    expect(only.freeze).toHaveBeenCalledTimes(1)

    rerender(<HeroFusion theme="dark" />)
    expect(root().dataset.mode).toBe("live")
    expect(only.thaw).toHaveBeenCalledTimes(1)

    expect(beams.mountBeams).toHaveBeenCalledTimes(1)
    expect(only.dispose).not.toHaveBeenCalled()
  })

  it("满 5 秒进 settled 并定格；之后换主题只重绘一帧，不重启动效", () => {
    vi.useFakeTimers()
    const only = engine()
    mountReturns(only)

    const { rerender, container } = render(<HeroFusion theme="light" />)
    const root = () => container.querySelector(".hero-fusion") as HTMLElement

    expect(root().dataset.mode).toBe("live")
    expect(only.freeze).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(5000))

    expect(root().dataset.mode).toBe("settled")
    expect(only.freeze).toHaveBeenCalledTimes(1)
    expect(container.querySelector(".hero-fusion__optics")?.classList).not.toContain("is-drifting")

    rerender(<HeroFusion theme="dark" />)
    expect(only.repaint).toHaveBeenCalledTimes(1)
    expect(only.wake).not.toHaveBeenCalled()
    expect(only.thaw).not.toHaveBeenCalled()
  })

  it("卸载后 5 秒窗口的计时器被清掉，不会再改状态", () => {
    vi.useFakeTimers()
    const only = engine()
    mountReturns(only)

    const { unmount } = render(<HeroFusion theme="light" />)
    unmount()

    act(() => vi.advanceTimersByTime(6000))
    expect(only.freeze).not.toHaveBeenCalled()
  })

  it("5 秒窗口只算可见时长：后台标签页不会把动效窗口耗光", () => {
    vi.useFakeTimers()
    const only = engine()
    mountReturns(only)

    const { container } = render(<HeroFusion theme="light" />)
    const root = () => container.querySelector(".hero-fusion") as HTMLElement

    // 前台看了 2 秒
    act(() => vi.advanceTimersByTime(2000))
    expect(root().dataset.mode).toBe("live")

    // 切到后台 30 秒：一次都不该画到定格
    setHidden(true)
    act(() => vi.advanceTimersByTime(30_000))
    expect(root().dataset.mode).toBe("live")
    expect(only.freeze).not.toHaveBeenCalled()

    // 切回前台，还剩 3 秒
    setHidden(false)
    act(() => vi.advanceTimersByTime(2999))
    expect(root().dataset.mode).toBe("live")

    act(() => vi.advanceTimersByTime(1))
    expect(root().dataset.mode).toBe("settled")
    expect(only.freeze).toHaveBeenCalledTimes(1)
  })

  it("换主题时 DOM 的主题类名还没跟上，就用同主题兜底色，不读上一套令牌", () => {
    const only = engine()
    mountReturns(only)
    document.documentElement.style.setProperty("--brand-glass-optical-tint", "#123456")

    const { rerender } = render(<HeroFusion theme="dark" />)
    const color = () => beams.mountBeams.mock.calls.at(-1)![0].getSettings().color

    // DOM 上还是亮色（ThemeProvider 的 effect 还没跑）：必须用暗色兜底，不能读令牌。
    expect(color()).toBe("#7cc4ff")

    // DOM 跟上之后才读令牌。
    document.documentElement.classList.add("dark")
    rerender(<HeroFusion theme="dark" />)
    // 注意：settings 是在 effect 里换的，而 effect 只有 theme 变了才跑，
    // 所以这里再切一次主题把重算逼出来。
    rerender(<HeroFusion theme="light" />)
    rerender(<HeroFusion theme="dark" />)
    expect(color()).toBe("#123456")

    document.documentElement.classList.remove("dark")
    document.documentElement.style.removeProperty("--brand-glass-optical-tint")
  })

  it("上下文丢失：切静态，把引擎回收掉，且不再重挂", () => {
    const only = engine()
    mountReturns(only)

    const { container } = render(<HeroFusion theme="light" />)
    const onContextLost = beams.mountBeams.mock.calls[0][0].onContextLost as () => void

    act(() => onContextLost())

    const root = container.querySelector(".hero-fusion") as HTMLElement
    expect(root.dataset.mode).toBe("static")
    expect(container.querySelector("canvas")).toBeNull()
    expect(container.querySelector(".hero-fusion__static-wash")).not.toBeNull()
    // 静态画面仍然保留棱镜与色散扇，不是一块空白。
    expect(container.querySelector(".hero-fusion__prism")).not.toBeNull()
    expect(only.dispose).toHaveBeenCalledTimes(1)
    expect(beams.mountBeams).toHaveBeenCalledTimes(1)
  })

  it("引擎拿不到（WebGL2 不可用）时直接静态降级", () => {
    beams.mountBeams.mockReturnValue(null)

    const { container } = render(<HeroFusion theme="dark" />)

    const root = container.querySelector(".hero-fusion") as HTMLElement
    expect(root.dataset.mode).toBe("static")
    expect(container.querySelector(".hero-fusion__static-wash")).not.toBeNull()
  })

  it("系统在运行中打开「减少动态效果」，画面当场冻结并停掉 SVG 漂移", () => {
    const only = engine()
    mountReturns(only)

    const media = installMatchMedia(false)
    const { container } = render(<HeroFusion theme="light" />)
    const root = () => container.querySelector(".hero-fusion") as HTMLElement

    expect(root().dataset.mode).toBe("live")
    expect(container.querySelector(".hero-fusion__optics")?.classList).toContain("is-drifting")

    act(() => media.set(true))

    expect(root().dataset.mode).toBe("frozen")
    expect(only.freeze).toHaveBeenCalledTimes(1)
    expect(container.querySelector(".hero-fusion__optics")?.classList).not.toContain("is-drifting")

    act(() => media.set(false))
    expect(root().dataset.mode).toBe("live")
    expect(only.thaw).toHaveBeenCalledTimes(1)
  })

  it("首帧就是定格态（挂载时已开启减少动态效果）时，引擎一挂上就冻结", () => {
    const only = engine()
    mountReturns(only)
    installMatchMedia(true)

    render(<HeroFusion theme="light" />)

    expect(only.freeze).toHaveBeenCalledTimes(1)
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

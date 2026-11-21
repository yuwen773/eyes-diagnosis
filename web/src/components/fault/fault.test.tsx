// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { FaultNote, FaultProvider, FaultToaster, useFault } from "./index"
import { faultFromError, infoFault, validationFault } from "@/lib/faults"
import { ApiError } from "@/lib/api"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function Harness({ onPush }: { onPush: (push: (f: ReturnType<typeof infoFault>) => void) => void }) {
  const { push } = useFault()
  onPush(push)
  return null
}

describe("FaultNote", () => {
  it("行内提示带上标签、结论与补充", () => {
    render(<FaultNote fault={validationFault("两次输入的密码不一致")} />)
    const note = screen.getByRole("alert")
    expect(note.textContent).toContain("CHECK")
    expect(note.textContent).toContain("两次输入的密码不一致")
  })

  it("字段级不摆标签，只留一行小字", () => {
    render(<FaultNote fault={validationFault("账号至少 4 位")} variant="field" />)
    const note = screen.getByRole("alert")
    expect(note.textContent).not.toContain("CHECK")
    expect(note.textContent).toContain("账号至少 4 位")
  })

  it("整块读数摆出状态码与端点读数", () => {
    render(
      <FaultNote
        fault={faultFromError(new ApiError(502, "bad gateway"))}
        variant="panel"
        readouts={[
          { label: "状态", value: "502" },
          { label: "端点", value: "/api/news" },
        ]}
      />,
    )
    expect(screen.getByText("502")).toBeTruthy()
    expect(screen.getByText("/api/news")).toBeTruthy()
    expect(screen.getByText("FAULT")).toBeTruthy()
  })

  it("动作可点", () => {
    const run = vi.fn()
    render(<FaultNote fault={infoFault("已复制")} action={{ label: "重试", run }} />)
    screen.getByRole("button", { name: "重试" }).click()
    expect(run).toHaveBeenCalled()
  })
})

describe("FaultToaster", () => {
  it("投放后浮出读数条，带标签与状态码", () => {
    let push: ((f: ReturnType<typeof infoFault>) => void) | null = null
    render(
      <FaultProvider>
        <Harness onPush={(p) => (push = p)} />
        <FaultToaster />
      </FaultProvider>,
    )
    act(() => {
      push?.(faultFromError(new ApiError(500, "boom")))
    })
    expect(screen.getByText("FAULT")).toBeTruthy()
    expect(screen.getByText("500")).toBeTruthy()
    expect(screen.getByText("服务这会儿没有响应")).toBeTruthy()
  })

  it("关闭按钮收掉那条读数", () => {
    vi.useFakeTimers()
    let push: ((f: ReturnType<typeof infoFault>) => void) | null = null
    render(
      <FaultProvider>
        <Harness onPush={(p) => (push = p)} />
        <FaultToaster />
      </FaultProvider>,
    )
    act(() => {
      push?.(infoFault("已复制到剪贴板"))
    })
    expect(screen.getByText("已复制到剪贴板")).toBeTruthy()
    act(() => {
      screen.getByRole("button", { name: "关闭提示" }).click()
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByText("已复制到剪贴板")).toBeNull()
  })

  it("没有 Provider 时投放不报错（组件单测里单独渲染也不该崩）", () => {
    function Lonely() {
      const { push } = useFault()
      push(infoFault("随手一条"))
      return null
    }
    expect(() => render(<Lonely />)).not.toThrow()
  })
})

/** jsdom 没实现 PointerEvent，手搓一个带坐标的原生事件。 */
function pointer(type: string, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clientY", { value: y })
  Object.defineProperty(event, "button", { value: 0 })
  Object.defineProperty(event, "pointerId", { value: 1 })
  return event
}

describe("FaultToaster 的下滑关闭", () => {
  function mountToaster() {
    let push: ((f: ReturnType<typeof infoFault>) => void) | null = null
    render(
      <FaultProvider>
        <Harness onPush={(p) => (push = p)} />
        <FaultToaster />
      </FaultProvider>,
    )
    return (f: ReturnType<typeof infoFault>) => act(() => push?.(f))
  }

  it("往下滑过阈值，这条读数就被收掉", () => {
    vi.useFakeTimers()
    const push = mountToaster()
    push(infoFault("资料已更新"))
    const card = document.querySelector(".fault-toast__card") as HTMLElement
    expect(card).toBeTruthy()

    act(() => {
      card.dispatchEvent(pointer("pointerdown", 0))
      card.dispatchEvent(pointer("pointermove", 90))
      card.dispatchEvent(pointer("pointerup", 90))
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText("资料已更新")).toBeNull()
  })

  it("没滑够就弹回去，这条读数还在", () => {
    vi.useFakeTimers()
    const push = mountToaster()
    push(infoFault("资料已更新"))
    const card = document.querySelector(".fault-toast__card") as HTMLElement

    act(() => {
      card.dispatchEvent(pointer("pointerdown", 0))
      card.dispatchEvent(pointer("pointermove", 20))
      card.dispatchEvent(pointer("pointerup", 20))
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText("资料已更新")).toBeTruthy()
  })

  it("快甩一下也收掉", () => {
    vi.useFakeTimers()
    // 甩动判定依赖 performance.now 的实际间隔；并行跑测试时真实 sleep 会漂，
    // 把时钟钉死成 20ms 才能稳定测到「距离 24+ 且速度 0.8px/ms 以上」。
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const push = mountToaster()
    push(infoFault("资料已更新"))
    const card = document.querySelector(".fault-toast__card") as HTMLElement

    act(() => {
      card.dispatchEvent(pointer("pointerdown", 0))
      now = 20
      card.dispatchEvent(pointer("pointermove", 30))
      card.dispatchEvent(pointer("pointerup", 30))
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText("资料已更新")).toBeNull()
  })

  it("critical 不给划走：错误信息不能被一次手滑抹掉", () => {
    vi.useFakeTimers()
    const push = mountToaster()
    push(faultFromError(new ApiError(500, "boom")))
    const card = document.querySelector(".fault-toast__card") as HTMLElement
    expect(card.dataset.swipeable).toBe("false")

    act(() => {
      card.dispatchEvent(pointer("pointerdown", 0))
      card.dispatchEvent(pointer("pointermove", 120))
      card.dispatchEvent(pointer("pointerup", 120))
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText("服务这会儿没有响应")).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { FaultNote, FaultProvider, FaultToaster, useFault } from "./index"
import { faultFromError, infoFault, validationFault } from "@/lib/faults"
import { ApiError } from "@/lib/api"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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

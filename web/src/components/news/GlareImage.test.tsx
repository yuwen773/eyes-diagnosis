// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { GlareImage } from "./GlareImage"

afterEach(cleanup)

/** jsdom 不排版，量不到尺寸——这里给一个固定的框，光斑位置才是可断言的。 */
function stubRect(el: HTMLElement, width = 200, height = 100) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

function renderGlare() {
  const { container } = render(
    <GlareImage src="https://example.com/cover.jpg" alt="封面" className="journal-card__plate" />,
  )
  const el = container.querySelector(".glare") as HTMLElement
  stubRect(el)
  return { container, el }
}

describe("GlareImage", () => {
  it("默认光斑是关着的：没指针就别亮", () => {
    const { el } = renderGlare()
    expect(el.dataset.glare).toBe("off")
  })

  it("指针进来才亮，并把位置写进 CSS 变量（不触发 React 重渲染）", () => {
    const { el } = renderGlare()

    fireEvent.pointerMove(el, { clientX: 100, clientY: 50, pointerType: "mouse" })

    expect(el.dataset.glare).toBe("on")
    expect(el.style.getPropertyValue("--gx")).toBe("50.00%")
    expect(el.style.getPropertyValue("--gy")).toBe("50.00%")
  })

  it("触屏不跟手：点一下发光是错觉", () => {
    const { el } = renderGlare()

    fireEvent.pointerMove(el, { clientX: 100, clientY: 50, pointerType: "touch" })

    expect(el.dataset.glare).toBe("off")
  })

  it("指针离开就收掉", () => {
    const { el } = renderGlare()

    fireEvent.pointerMove(el, { clientX: 100, clientY: 50, pointerType: "mouse" })
    fireEvent.pointerLeave(el)

    expect(el.dataset.glare).toBe("off")
  })

  it("尺寸还没排出来时不算位置：不会写出 Infinity%", () => {
    const { container } = render(
      <GlareImage src="https://example.com/cover.jpg" alt="封面" />,
    )
    const el = container.querySelector(".glare") as HTMLElement
    // 不 stub：jsdom 的 rect 全是 0，等于「还没排版」。
    fireEvent.pointerMove(el, { clientX: 100, clientY: 50, pointerType: "mouse" })

    expect(el.dataset.glare).toBe("off")
    expect(el.style.getPropertyValue("--gx")).not.toContain("Infinity")
  })

  it("光斑是纯装饰层：不挡点击，也不进无障碍树", () => {
    const { container } = renderGlare()
    const sheen = container.querySelector(".glare__sheen")

    expect(sheen?.getAttribute("aria-hidden")).toBe("true")
    expect(sheen?.className).toContain("glare__sheen")
  })
})

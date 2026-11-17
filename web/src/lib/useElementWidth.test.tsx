// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { useRef } from "react"

import { useElementWidth } from "./useElementWidth"

afterEach(() => {
  cleanup()
  // 还原被改写的原型属性：jsdom 把 offsetWidth 挂在 HTMLElement.prototype
  // 上，直接 delete 会把它整个删掉，后面就读不到宽度了。
  if (ORIGINAL_OFFSET_WIDTH) {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", ORIGINAL_OFFSET_WIDTH)
  }
})

const ORIGINAL_OFFSET_WIDTH = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
)

function stubLayout(width: number, rectWidth = width * 2) {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return width
    },
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: rectWidth,
    height: 100,
    right: rectWidth,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  return <div ref={ref}>{String(width)}</div>
}

describe("useElementWidth", () => {
  it("读布局宽（offsetWidth），不读缩放后的视觉宽（getBoundingClientRect）", () => {
    stubLayout(390, 195)
    const { container } = render(<Probe />)

    // 管理端预览把整页 transform: scale(0.5)，rect 读到 195，布局宽才是 390。
    expect(container.querySelector("div")?.textContent).toBe("390")
  })

  it("环境里量不到宽度时返回 0，调用方按「未知」处理", () => {
    const { container } = render(<Probe />)
    expect(container.querySelector("div")?.textContent).toBe("0")
  })
})

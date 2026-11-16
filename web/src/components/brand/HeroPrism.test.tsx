// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HeroPrism } from "./HeroPrism"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("HeroPrism", () => {
  it("WebGL2 不可用时切到静态棱镜，而不是留一块空白", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)

    const { container } = render(<HeroPrism theme="light" />)

    await waitFor(() => {
      expect(container.querySelector(".hero-prism__fallback")).not.toBeNull()
    })
    expect(container.querySelector(".hero-prism")?.getAttribute("data-mode")).toBe("static")
  })

  it("主题写到容器上，静态降级按主题取色", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)

    const { container } = render(<HeroPrism theme="dark" />)

    expect(container.querySelector(".hero-prism")?.getAttribute("data-theme")).toBe("dark")
  })
})

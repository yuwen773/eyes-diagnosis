// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HeroPrism } from "./HeroPrism"
import {
  installFakeWebgl2,
  installRafHarness,
} from "../../test/webglHarness"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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

  it("上下文丢失后卸载画布并切静态棱镜", async () => {
    installFakeWebgl2()
    installRafHarness()

    const { container } = render(<HeroPrism theme="light" />)
    const canvas = container.querySelector("canvas")
    expect(canvas).not.toBeNull()

    act(() => {
      canvas!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))
    })

    await waitFor(() => {
      expect(container.querySelector(".hero-prism__fallback")).not.toBeNull()
    })
    expect(container.querySelector(".hero-prism")?.getAttribute("data-mode")).toBe("static")
    expect(container.querySelector("canvas")).toBeNull()
  })

  it("亮/暗切换只更新色板，不重建 WebGL 上下文", () => {
    const { webgl2Requests } = installFakeWebgl2()
    installRafHarness()

    const { container, rerender } = render(<HeroPrism theme="light" />)
    const canvas = container.querySelector("canvas")
    expect(webgl2Requests()).toBe(1)

    rerender(<HeroPrism theme="dark" />)

    expect(container.querySelector(".hero-prism")?.getAttribute("data-theme")).toBe("dark")
    expect(container.querySelector("canvas")).toBe(canvas)
    expect(webgl2Requests()).toBe(1)
  })
})

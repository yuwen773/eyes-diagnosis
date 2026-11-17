// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RouteErrorBoundary } from "./RouteErrorBoundary"

function Boom(): never {
  throw new Error("渲染炸了")
}

describe("RouteErrorBoundary", () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React 会把被边界接住的错误打一遍 console.error；测试里不需要这份噪声。
    spy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    spy.mockRestore()
  })

  it("渲染期抛错时给故障读数，而不是白屏", () => {
    render(
      <RouteErrorBoundary resetKey="/records">
        <Boom />
      </RouteErrorBoundary>,
    )
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.getByText("这个页面没能显示出来")).toBeTruthy()
    expect(screen.getByRole("button", { name: /重新加载本页/ })).toBeTruthy()
    // 持续失败时仍有一条不依赖重载的离场路径。
    expect(screen.getByRole("link", { name: /回到首页/ }).getAttribute("href")).toBe("/")
    // 不谎称已上报，也不展示堆栈。
    expect(screen.queryByText(/已经记下/)).toBeNull()
    expect(screen.queryByText(/渲染炸了/)).toBeNull()
  })

  it("换路由（resetKey 变化）后自动复位", () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/records">
        <Boom />
      </RouteErrorBoundary>,
    )
    expect(screen.getByRole("alert")).toBeTruthy()

    rerender(
      <RouteErrorBoundary resetKey="/profile">
        <p>资料页</p>
      </RouteErrorBoundary>,
    )
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByText("资料页")).toBeTruthy()
  })
})

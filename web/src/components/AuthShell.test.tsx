// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { AuthShell } from "./AuthShell"
import { ThemeProvider } from "@/components/theme-provider"
import { installFakeWebgl2, installRafHarness } from "@/test/webglHarness"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderShell() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <AuthShell kicker="Sign in · 登录" title="进入判读台" sub="用已有账号登录。">
          <div />
        </AuthShell>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe("AuthShell 背景降级", () => {
  it("有 WebGL2 时用纤维光场，虹膜环不进 DOM", () => {
    installFakeWebgl2()
    installRafHarness()

    const { container } = renderShell()

    expect(container.querySelector(".threads-canvas")).not.toBeNull()
    expect(container.querySelector(".auth-auth__iris")).toBeNull()
  })

  it("WebGL2 不可用时退回纯 CSS 光学资产", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null)

    const { container } = renderShell()

    expect(container.querySelector(".threads-canvas")).toBeNull()
    expect(container.querySelector(".auth-auth__iris")).not.toBeNull()
    expect(container.querySelector(".auth-auth__beam")).not.toBeNull()
  })
})

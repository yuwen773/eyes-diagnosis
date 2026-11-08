// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { AgentPage } from "./AgentPage"

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    status: "anon",
    user: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
})

/** jsdom 没有 matchMedia——主题探测要用。 */
function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

describe("AgentPage 未登录", () => {
  it("先展示界面，不直接把人踢去登录页", () => {
    stubMatchMedia()
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/login" element={<div>登录页</div>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    // 界面在，欢迎屏可见
    expect(screen.getByText("眼科智能助手")).toBeTruthy()
    expect(screen.queryByText("登录页")).toBeNull()
  })
})

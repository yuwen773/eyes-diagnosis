// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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
    expect(screen.getByText(/EyeSight/)).toBeTruthy()
    expect(screen.queryByText("登录页")).toBeNull()
  })

  it("收起会话栏后布局切单列（不塌成 280px 窄条），恢复钮出现", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "收起会话栏" }))

    const layout = document.querySelector(".agent-layout")!
    expect(layout.className).toContain("agent-layout--no-left")
    expect(layout.className).not.toContain("agent-sessions")
    expect(document.querySelector(".agent-sessions")).toBeNull()
    // 左上角恢复钮组在
    expect(screen.getByRole("button", { name: "展开会话栏" })).toBeTruthy()
    // 再展开，侧栏回来
    fireEvent.click(screen.getByRole("button", { name: "展开会话栏" }))
    expect(document.querySelector(".agent-sessions")).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
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

describe("AgentPage 未登录", () => {
  it("直接跳登录页并带回跳地址，不展示死胡同告示", () => {
    render(
      <MemoryRouter initialEntries={["/agent"]}>
        <Routes>
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/login" element={<div>登录页</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText("登录页")).toBeTruthy()
    expect(screen.queryByText(/需要登录/)).toBeNull()
  })
})

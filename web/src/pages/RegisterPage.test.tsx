// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { ApiError } from "@/lib/api"

const api = vi.hoisted(() => ({
  register: vi.fn(),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, register: api.register }
})

import { RegisterPage } from "./RegisterPage"

beforeEach(() => {
  api.register.mockReset()
})

afterEach(() => {
  cleanup()
})

/** 登录页替身：只读取跳转带来的 state，用来验证注册回执。 */
function LoginProbe() {
  const location = useLocation()
  const state = location.state as { created?: boolean; account?: string } | null
  return <div data-testid="login-probe">{state?.created ? `created:${state.account}` : "none"}</div>
}

function renderRegister() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

function fill(account: string, password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText("账号 · Account"), { target: { value: account } })
  fireEvent.change(screen.getByLabelText("密码 · Password"), { target: { value: password } })
  fireEvent.change(screen.getByLabelText("确认密码 · Confirm"), { target: { value: confirm } })
}

describe("RegisterPage", () => {
  it("注册成功后带着账号跳到登录页，供登录页给出回执", async () => {
    api.register.mockResolvedValueOnce(undefined)

    renderRegister()
    fill("doctor01", "password123")
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }))

    const probe = await screen.findByTestId("login-probe")
    expect(probe.textContent).toBe("created:doctor01")
  })

  it("账号重复时说的是「已经注册过了」，不是「条件不对」", async () => {
    api.register.mockRejectedValueOnce(new ApiError(40000, "账号重复"))

    renderRegister()
    fill("doctor01", "password123")
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }))

    expect(await screen.findByText("这个账号已经注册过了")).toBeTruthy()
    expect(screen.queryByText("这次请求的条件不对")).toBeNull()
  })

  it("两次密码不一致时停在字段校验，不发请求", async () => {
    renderRegister()
    fill("doctor01", "password123", "password124")
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }))

    expect(await screen.findByText("两次输入的密码不一致")).toBeTruthy()
    expect(api.register).not.toHaveBeenCalled()
  })
})

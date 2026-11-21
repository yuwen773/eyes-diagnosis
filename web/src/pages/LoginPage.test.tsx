// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { ApiError } from "@/lib/api"

const session = vi.hoisted(() => ({
  signIn: vi.fn(),
}))

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    user: null,
    status: "anon",
    scope: "anonymous",
    probeError: null,
    signIn: session.signIn,
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))

import { LoginPage } from "./LoginPage"

beforeEach(() => {
  session.signIn.mockReset()
})

afterEach(() => {
  cleanup()
})

function renderLogin(entry: { pathname: string; state?: unknown } = { pathname: "/login" }) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[entry]}>
        <LoginPage />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe("LoginPage", () => {
  it("注册回执：预填账号并提示「账号已创建」", () => {
    renderLogin({
      pathname: "/login",
      state: { created: true, account: "doctor01" },
    })

    expect((screen.getByLabelText("账号 · Account") as HTMLInputElement).value).toBe("doctor01")
    expect(screen.getByText("账号已创建")).toBeTruthy()
    expect(screen.getByText("请用刚才的账号登录。")).toBeTruthy()
  })

  it("没有回执时不显示创建提示，账号为空", () => {
    renderLogin()

    expect((screen.getByLabelText("账号 · Account") as HTMLInputElement).value).toBe("")
    expect(screen.queryByText("账号已创建")).toBeNull()
  })

  it("输错密码时说的是「账号或密码不对」，并收起创建回执", async () => {
    session.signIn.mockRejectedValueOnce(new ApiError(40000, "用户不存在或密码错误"))

    renderLogin({
      pathname: "/login",
      state: { created: true, account: "doctor01" },
    })

    fireEvent.change(screen.getByLabelText("密码 · Password"), {
      target: { value: "wrongpass" },
    })
    fireEvent.click(screen.getByRole("button", { name: "登录" }))

    expect(await screen.findByText("账号或密码不对")).toBeTruthy()
    expect(screen.queryByText("账号已创建")).toBeNull()
    expect(session.signIn).toHaveBeenCalledWith("doctor01", "wrongpass")
  })

  it("密码字段下有找回密码说明，并挂在 aria-describedby 上", () => {
    renderLogin()

    const hint = screen.getByText("忘记密码？请联系管理员重置。")
    expect(hint.className).toContain("field__hint")
    expect(hint.querySelector("a")).toBeNull()
    expect(
      screen.getByLabelText("密码 · Password").getAttribute("aria-describedby"),
    ).toContain("password-hint")
  })

  it("空账号先给字段级校验，不发请求", async () => {
    renderLogin()

    fireEvent.click(screen.getByRole("button", { name: "登录" }))

    expect(await screen.findByText("请填写账号")).toBeTruthy()
    expect(session.signIn).not.toHaveBeenCalled()
  })
})

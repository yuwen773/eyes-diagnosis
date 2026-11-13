// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { AccountMenu } from "@/components/AccountMenu"

const sessionState = vi.hoisted(() => ({
  status: "anon" as string,
  user: null as null | {
    id?: string
    userAccount?: string
    userName?: string
    userAvatar?: string
    userRole?: string
  },
  signOut: vi.fn(),
}))

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    user: sessionState.user,
    status: sessionState.status,
    signOut: sessionState.signOut,
  }),
}))

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={["/agent"]}>
      <Routes>
        <Route path="/agent" element={<AccountMenu />} />
        <Route path="/" element={<div>首页</div>} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function ordinaryUser() {
  sessionState.status = "authed"
  sessionState.user = {
    id: "1",
    userAccount: "dr_lin",
    userName: "林医生",
    userRole: "user",
  }
}

function adminUser() {
  sessionState.status = "authed"
  sessionState.user = {
    id: "2",
    userAccount: "admin",
    userName: "系统管理员",
    userRole: "admin",
  }
}

afterEach(() => {
  cleanup()
  sessionState.status = "anon"
  sessionState.user = null
  sessionState.signOut.mockReset()
})

describe("AccountMenu", () => {
  it("未登录时只给登录入口", () => {
    renderMenu()
    expect(screen.getByRole("link", { name: "登录" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /账号菜单/ })).toBeNull()
  })

  it("登录后展示昵称与四个目的地，普通用户没有系统管理", () => {
    ordinaryUser()
    renderMenu()
    const trigger = screen.getByRole("button", { name: "账号菜单：林医生" })
    // 昵称可截断，但完整名称挂在 title 上。
    expect(screen.getByText("林医生").getAttribute("title")).toBe("林医生")

    fireEvent.click(trigger)
    expect(screen.getByRole("menuitem", { name: /个人中心/ })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /判读记录/ })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /退出登录/ })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: /系统管理/ })).toBeNull()
    // 不虚构在线状态 / 会员等级。
    expect(screen.queryByText(/在线/)).toBeNull()
    expect(screen.queryByText(/会员/)).toBeNull()
  })

  it("管理员才出现系统管理入口", () => {
    adminUser()
    renderMenu()
    fireEvent.click(screen.getByRole("button", { name: "账号菜单：系统管理员" }))
    expect(screen.getByRole("menuitem", { name: /系统管理/ })).toBeTruthy()
  })

  it("有真实头像时用头像，没有时退回昵称首字符", () => {
    ordinaryUser()
    sessionState.user = { ...sessionState.user, userAvatar: "https://example.com/a.png" }
    const { unmount } = renderMenu()
    const img = document.querySelector(".acct__avatar img") as HTMLImageElement
    expect(img.getAttribute("src")).toBe("https://example.com/a.png")
    unmount()

    sessionState.user = { ...sessionState.user, userAvatar: undefined }
    renderMenu()
    expect(document.querySelector(".acct__avatar img")).toBeNull()
    expect(document.querySelector(".acct__avatar-initial")?.textContent).toBe("林")
  })

  it("键盘打开、Esc 关闭并把焦点还给触发按钮", async () => {
    ordinaryUser()
    renderMenu()
    const trigger = screen.getByRole("button", { name: /账号菜单/ })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: "ArrowDown" })

    const profile = await screen.findByRole("menuitem", { name: /个人中心/ })
    expect(document.body.contains(profile)).toBe(true)

    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: /个人中心/ })).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  })

  it("退出登录调用 signOut 并回到首页", async () => {
    ordinaryUser()
    sessionState.signOut.mockResolvedValue(undefined)
    renderMenu()
    fireEvent.click(screen.getByRole("button", { name: /账号菜单/ }))
    fireEvent.click(screen.getByRole("menuitem", { name: /退出登录/ }))

    await waitFor(() => expect(sessionState.signOut).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("首页")).toBeTruthy()
  })
})

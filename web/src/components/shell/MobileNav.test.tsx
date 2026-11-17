// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const sessionState = vi.hoisted(() => ({
  status: "anon" as string,
  user: null as null | { id?: string; userRole?: string },
  signOut: vi.fn(),
}))

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    user: sessionState.user,
    status: sessionState.status,
    signIn: vi.fn(),
    signOut: sessionState.signOut,
    refresh: vi.fn(),
  }),
}))

/** navLinks 在模块加载期读取开关；每个用例先卸载模块再动态导入，覆盖两种配置。 */
async function headerFor(flag: "true" | "false") {
  vi.resetModules()
  vi.stubEnv("VITE_COLLABORATION_ENABLED", flag)
  // 与 ProductHeader 同一次模块图里取 ThemeProvider：resetModules 后
  // 顶层静态 import 的 provider 上下文会是另一个实例，useTheme 会找不到。
  const { ThemeProvider } = await import("@/components/theme-provider")
  const mod = await import("@/components/shell/ProductHeader")
  const { NAV_LINKS } = await import("@/components/shell/navLinks")
  return { Header: mod.ProductHeader, NAV_LINKS, ThemeProvider }
}

type HeaderModule = Awaited<ReturnType<typeof headerFor>>

function renderHeader({ Header, ThemeProvider }: HeaderModule) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/agent"]}>
        <Header />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

function setAdmin() {
  sessionState.status = "authed"
  sessionState.user = { id: "2", userRole: "admin" }
}
function setUser() {
  sessionState.status = "authed"
  sessionState.user = { id: "1", userRole: "user" }
}
function setAnon() {
  sessionState.status = "anon"
  sessionState.user = null
}

async function openDrawer(mod: HeaderModule) {
  renderHeader(mod)
  fireEvent.click(screen.getByRole("button", { name: "打开导航" }))
  const drawer = screen.getByRole("dialog", { name: "主导航" })
  expect(drawer.getAttribute("aria-hidden")).toBe("false")
  return drawer
}

/** 在每个视口宽度上模拟折叠判定：≤900 用共享断点，901–1099 用协作专用断点。 */
function stubViewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 900px")
      ? width <= 900
      : query.includes("1099px")
        ? width > 900 && width <= 1099
        : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  setAnon()
})

describe("MobileNav · 折叠导航下的管理员入口", () => {
  it.each(["true", "false"] as const)(
    "协作开关=%s：管理员在抽屉账号区能看到系统管理，指向 /admin",
    async (flag) => {
      setAdmin()
      const mod = await headerFor(flag)
      const drawer = await openDrawer(mod)
      const link = screen.getByRole("link", { name: "系统管理" })
      expect(link.getAttribute("href")).toBe("/admin")
      expect(drawer.contains(link)).toBe(true)
      // 产品区与账号区都可访问，抽屉里的链接有可读名称。
      expect(screen.getByRole("navigation", { name: "产品" })).toBeTruthy()
      expect(screen.getByRole("navigation", { name: "账号" })).toBeTruthy()
    },
  )

  it.each(["true", "false"] as const)(
    "协作开关=%s：普通用户与未登录都没有系统管理入口",
    async (flag) => {
      setUser()
      const mod = await headerFor(flag)
      const userDrawer = await openDrawer(mod)
      const userNav = screen.getByRole("navigation", { name: "账号" })
      expect(userDrawer.contains(screen.queryByRole("link", { name: "系统管理" }))).toBe(false)
      expect(within(userNav).getByRole("link", { name: "个人中心" })).toBeTruthy()
      cleanup()

      setAnon()
      const anonMod = await headerFor(flag)
      const anonDrawer = await openDrawer(anonMod)
      const anonNav = screen.getByRole("navigation", { name: "账号" })
      expect(anonDrawer.querySelector('a[href="/admin"]')).toBeNull()
      expect(within(anonNav).getByRole("link", { name: "登录" })).toBeTruthy()
    },
  )

  it("管理员的系统管理链接就在账号导航内（不是桌面菜单误匹配）", async () => {
    setAdmin()
    const mod = await headerFor("true")
    const drawer = await openDrawer(mod)
    const accountNav = screen.getByRole("navigation", { name: "账号" })
    expect(within(accountNav).getByRole("link", { name: "系统管理" })).toBeTruthy()
    expect(drawer.contains(accountNav)).toBe(true)
  })
})

describe("MobileNav · 901–1099px 折叠策略", () => {
  it("折叠断点与协作链接绑定，账号区在窗口内被隐藏", async () => {
    const { NAV_LINKS } = await headerFor("true")
    expect(NAV_LINKS.some((item) => item.to === "/agent/collaboration")).toBe(true)
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const css = readFileSync(resolve("src/styles/shell.css"), "utf8")
    expect(css).toContain("@media (900px < width <= 1099px)")
    expect(css).toContain(
      '.product-head:has(.product-head__link[href="/agent/collaboration"])',
    )
    // 折叠窗口内账号控件被隐藏，抽屉必须提供 /admin 的替代入口。
    expect(css).toMatch(/\.product-head__actions \.acct[\s\S]{0,120}display: none/)
  })

  it.each([360, 820, 900, 901, 1024, 1099, 1100])(
    "%dpx：管理员抽屉始终有系统管理，产品导航条目与宽度无关",
    async (width) => {
      setAdmin()
      stubViewport(width)
      const mod = await headerFor("true")
      const drawer = await openDrawer(mod)
      const { NAV_LINKS } = mod
      const accountLinks = Array.from(
        drawer.querySelectorAll("nav[aria-label='账号'] a"),
      ).map((node) => node.textContent?.trim())
      expect(accountLinks).toContain("系统管理")
      expect(drawer.querySelectorAll("nav[aria-label='产品'] a")).toHaveLength(
        NAV_LINKS.length,
      )
    },
  )
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { BrandHeader } from "./BrandHeader"

vi.mock("@/lib/session", () => ({
  useSession: () => ({ status: "anon", user: null, signIn: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }),
}))

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <BrandHeader />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

afterEach(cleanup)

describe("BrandHeader", () => {
  it("是品牌变体：用 .brand-head，不借用 .site-head（否则全站顶栏会被动改样）", () => {
    const { container } = renderAt("/")
    const header = container.querySelector("header")
    expect(header).not.toBeNull()
    expect(header!.classList.contains("brand-head")).toBe(true)
    expect(header!.classList.contains("site-head")).toBe(false)
    expect(header!.hasAttribute("data-brand-head")).toBe(true)
  })

  it("三个跨产品目的地都在胶囊里，且指向真实路由", () => {
    renderAt("/")
    const nav = screen.getByRole("navigation", { name: "主导航" })
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    expect(links).toEqual(["/diagnosis", "/agent", "/news"])
  })

  it("当前路由是高亮胶囊（aria-current=page），其余不是", () => {
    const { container } = renderAt("/news")
    const current = container.querySelectorAll('.brand-head__link[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute("href")).toBe("/news")
  })

  it("首页没有匹配的导航项时，不给任何一项伪造当前态", () => {
    const { container } = renderAt("/")
    expect(container.querySelectorAll('.brand-head__link[aria-current="page"]')).toHaveLength(0)
  })

  it("右侧功能区有可访问名称：主题切换、账号、主 CTA", () => {
    renderAt("/")
    expect(screen.getByRole("button", { name: /切换到(浅色|暗色)主题/ })).toBeTruthy()
    expect(screen.getByRole("link", { name: "登录" })).toBeTruthy()
    expect(screen.getByRole("link", { name: /开始判读/ }).getAttribute("href")).toBe("/diagnosis")
  })

  it("导航链接带序号短码，读屏只读一次标签", () => {
    renderAt("/")
    const nav = screen.getByRole("navigation", { name: "主导航" })
    const first = nav.querySelector("a")!
    // 短码是 aria-hidden 的纯装饰，可访问名称里不应该混进 "01"。
    expect(first.textContent).toContain("判读")
    expect(first.querySelector(".brand-head__code")?.getAttribute("aria-hidden")).toBe("true")
  })
})

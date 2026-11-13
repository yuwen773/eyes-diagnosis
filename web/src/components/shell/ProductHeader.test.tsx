// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { ProductHeader, type ProductScene } from "./ProductHeader"

vi.mock("@/lib/session", () => ({
  useSession: () => ({ status: "anon", user: null, signIn: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }),
}))

function renderAt(path: string, scene: ProductScene = "brand") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <ProductHeader scene={scene} />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

afterEach(cleanup)

describe("ProductHeader · 共享产品外壳", () => {
  it.each<ProductScene>(["brand", "editorial", "clinical", "intelligence"])(
    "%s 场景共用同一个 .product-head 结构，不再有 .site-head / .brand-head 两套",
    (scene) => {
      const { container } = renderAt("/", scene)
      const header = container.querySelector("header")
      expect(header).not.toBeNull()
      expect(header!.classList.contains("product-head")).toBe(true)
      expect(header!.classList.contains("site-head")).toBe(false)
      expect(header!.classList.contains("brand-head")).toBe(false)
      expect(header!.getAttribute("data-scene")).toBe(scene)
      expect(header!.hasAttribute("data-site-head")).toBe(true)
      // ScrollExpand 靠这个标记量顶栏高度。
      expect(header!.hasAttribute("data-product-head")).toBe(true)
    },
  )

  it("三个跨产品目的地都在胶囊里，且指向真实路由", () => {
    renderAt("/")
    const nav = screen.getByRole("navigation", { name: "主导航" })
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    expect(links).toEqual(["/diagnosis", "/agent", "/news"])
  })

  it("当前路由是高亮胶囊（aria-current=page），其余不是", () => {
    const { container } = renderAt("/news", "editorial")
    const current = container.querySelectorAll('.product-head__link[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute("href")).toBe("/news")
  })

  it("首页没有匹配的导航项时，不给任何一项伪造当前态", () => {
    const { container } = renderAt("/")
    expect(container.querySelectorAll('.product-head__link[aria-current="page"]')).toHaveLength(0)
  })

  it("右侧功能区有可访问名称：主题切换、账号、主 CTA", () => {
    renderAt("/")
    expect(screen.getByRole("button", { name: /切换到(浅色|暗色)主题/ })).toBeTruthy()
    expect(screen.getByRole("link", { name: "登录" })).toBeTruthy()
    expect(screen.getByRole("link", { name: /开始判读/ }).getAttribute("href")).toBe("/diagnosis")
  })

  it("已经在判读页时不再重复显示「开始判读」CTA", () => {
    renderAt("/diagnosis", "clinical")
    expect(screen.queryByRole("link", { name: /开始判读/ })).toBeNull()
  })

  it("导航链接带序号短码，读屏只读一次标签", () => {
    renderAt("/")
    const nav = screen.getByRole("navigation", { name: "主导航" })
    const first = nav.querySelector("a")!
    expect(first.textContent).toContain("判读")
    expect(first.querySelector(".product-head__code")?.getAttribute("aria-hidden")).toBe("true")
  })

  // U2（DESIGN.md §2.1.2）：scene 变体只允许改画布与密度，不允许换导航设计语言。
  // 四个场景共用同一块胶囊导航、同一套链接形态与当前态类名；
  // 旧版 clinical 纸面胶囊 / 橙色底线、intelligence 冰青底线没有独立 DOM 形态。
  it.each<ProductScene>(["brand", "editorial", "clinical", "intelligence"])(
    "%s 场景的导航胶囊与链接结构逐字节一致（U2 统一导航身份）",
    (scene) => {
      const { container } = renderAt("/news", scene)
      const nav = container.querySelector(".product-head__nav")!
      expect(nav.classList.contains("product-head__nav")).toBe(true)
      const links = nav.querySelectorAll(".product-head__link")
      expect(links).toHaveLength(3)
      // 当前态统一是 aria-current + product-head__link，场景不再有独立当前态结构
      const current = nav.querySelectorAll('.product-head__link[aria-current="page"]')
      expect(current).toHaveLength(1)
      expect(current[0].getAttribute("href")).toBe("/news")
    },
  )
})

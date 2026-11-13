// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { BrandFooter } from "./BrandFooter"

vi.mock("@/lib/session", () => ({
  useSession: () => ({ status: "anon", user: null, signIn: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }),
}))

const SECTIONS = [
  { href: "#how", label: "判读流程" },
  { href: "#bounds", label: "责任边界" },
]

function renderFooter(sections = SECTIONS) {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <BrandFooter sections={sections} />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

afterEach(cleanup)

describe("BrandFooter", () => {
  it("三层信息架构都在：品牌收尾 / 信息导航 / 可信信息", () => {
    const { container } = renderFooter()
    expect(container.querySelector(".brand-foot__claim")?.textContent).toContain("看清更多")
    expect(screen.getByRole("navigation", { name: "产品" })).toBeTruthy()
    expect(container.querySelector(".brand-foot__note")?.textContent).toContain("不构成诊断结论")
  })

  it("产品链接只指向真实路由", () => {
    renderFooter()
    const nav = screen.getByRole("navigation", { name: "产品" })
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    expect(hrefs).toEqual(["/diagnosis", "/agent", "/news"])
  })

  it("页面章节按传入的锚点渲染，不自己编章节", () => {
    renderFooter()
    const nav = screen.getByRole("navigation", { name: "页面章节" })
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    expect(hrefs).toEqual(["#how", "#bounds"])
  })

  it("没有章节时不渲染空的章节导航", () => {
    renderFooter([])
    expect(screen.queryByRole("navigation", { name: "页面章节" })).toBeNull()
  })

  it("不凭空造未实现的页面：隐私政策 / 法律声明 / 联系方式 / 支持中心", () => {
    const { container } = renderFooter()
    const text = container.textContent ?? ""
    for (const invented of ["隐私政策", "法律声明", "联系方式", "支持中心", "服务条款"]) {
      expect(text).not.toContain(invented)
    }
  })

  it("既有规格信息保留：模型、类别数、质量门、权重指纹", () => {
    const { container } = renderFooter()
    const text = container.textContent ?? ""
    expect(text).toContain("EFFICIENTNET-B4")
    expect(text).toContain("8 CLASSES")
    expect(text).toContain("QUALITY GATE")
    expect(text).toContain("SHA-256 WEIGHTS")
  })

  it("返回顶部是按钮式链接，点了不会因为不存在的 #top 锚点落空", () => {
    const scrollTo = vi.fn()
    vi.stubGlobal("scrollTo", scrollTo)
    const { container } = renderFooter()
    const top = container.querySelector(".brand-foot__top") as HTMLAnchorElement
    fireEvent.click(top)
    expect(scrollTo).toHaveBeenCalled()
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 0 })
    vi.unstubAllGlobals()
  })
})

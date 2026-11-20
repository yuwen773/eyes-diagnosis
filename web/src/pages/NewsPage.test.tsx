// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { listNews, type NewsItem } from "@/lib/api"
import { ThemeProvider } from "@/components/theme-provider"

import { NewsPage } from "./NewsPage"

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    status: "anon",
    user: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, listNews: vi.fn() }
})

function record(index: number, prefix = "文章"): NewsItem {
  return {
    id: `${prefix}-${index}`,
    title: `${prefix} ${index}`,
    author: "编辑部",
    publishTime: "2026-11-02 09:00:00",
    content: "<p>正文</p>",
  }
}

function pageOf(current: number) {
  return {
    records: Array.from({ length: 9 }, (_, i) => record((current - 1) * 9 + i + 1)),
    total: 27,
    pages: 3,
  }
}

function renderPage() {
  // 每个用例一份新的缓存：否则上一个用例的结果会被当命中，翻页不会重新请求。
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/news"]}>
          <NewsPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

let scrolled: string[] = []

beforeEach(() => {
  scrolled = []
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function scrollIntoView(
    this: Element,
  ) {
    scrolled.push(this.className)
  })
  vi.mocked(listNews).mockImplementation(async (query) => pageOf(query?.current ?? 1))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.mocked(listNews).mockReset()
})

describe("NewsPage 换页落点", () => {
  it("点翻页之后回到列表开头——新一页的第一行不该停在屏幕外", async () => {
    renderPage()
    await screen.findByText(/文章 1$/)

    fireEvent.click(screen.getByRole("button", { name: /下一页/ }))
    await screen.findByText(/文章 10$/)

    expect(scrolled).toContain("wrap news")
  })

  it("在第 2 页检索不会把刚用过的检索框滚出视口", async () => {
    renderPage()
    await screen.findByText(/文章 1$/)

    fireEvent.click(screen.getByRole("button", { name: /下一页/ }))
    await screen.findByText(/文章 10$/)
    scrolled.length = 0

    // 检索会把页码重置回第 1 页——但这是检索动作，不是翻页动作，
    // 不能顺手滚一下把检索框推走。
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "白内障" } })
    fireEvent.submit(screen.getByRole("search"))

    await waitFor(() =>
      expect(vi.mocked(listNews).mock.calls.at(-1)?.[0]).toMatchObject({
        current: 1,
        title: "白内障",
      }),
    )
    expect(scrolled).toEqual([])
  })

  it("在第 2 页清除检索同样不滚", async () => {
    renderPage()
    await screen.findByText(/文章 1$/)

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "白内障" } })
    fireEvent.submit(screen.getByRole("search"))
    await waitFor(() => expect(vi.mocked(listNews).mock.calls.at(-1)?.[0]).toMatchObject({ title: "白内障" }))

    // 检索期间分页器会暂时消失（加载态），等它回来再点。
    fireEvent.click(await screen.findByRole("button", { name: /下一页/ }))
    await screen.findByText(/文章 10$/)
    scrolled.length = 0

    fireEvent.click(screen.getByRole("button", { name: /^清除$/ }))

    await waitFor(() =>
      expect(vi.mocked(listNews).mock.calls.at(-1)?.[0]).toMatchObject({ current: 1 }),
    )
    expect(scrolled).toEqual([])
  })
})

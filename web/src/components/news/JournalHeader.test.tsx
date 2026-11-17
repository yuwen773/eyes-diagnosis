// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import type { NewsItem } from "@/lib/api"

import { JournalHeader } from "./JournalHeader"

afterEach(cleanup)

const LATEST: NewsItem = {
  id: "9001",
  title: "白内障手术的窗口期比想象中宽",
  author: "编辑部",
  publishTime: "2026-11-02 09:30:00",
  content: "<p>正文</p>",
}

function renderHeader(overrides: Partial<Parameters<typeof JournalHeader>[0]> = {}) {
  const props = {
    latest: LATEST,
    keyword: "",
    onKeywordChange: vi.fn(),
    onSearch: vi.fn(),
    onClear: vi.fn(),
    searching: false,
    ...overrides,
  }
  const { container } = render(
    <MemoryRouter>
      <JournalHeader {...props} />
    </MemoryRouter>,
  )
  return { props, container }
}

describe("JournalHeader", () => {
  it("抬头里摆的是真实最新一条：标题、日期与作者都来自这一条", () => {
    renderHeader()

    const link = screen.getByRole("link", { name: LATEST.title })
    expect(link.getAttribute("href")).toBe("/news/9001")
    expect(screen.getByText(/2026-11-02/)).toBeTruthy()
    expect(screen.getByText(/编辑部/)).toBeTruthy()
  })

  it("没有最新一条就不摆头条位，也不编一条出来", () => {
    renderHeader({ latest: undefined })

    expect(screen.queryByRole("link", { name: LATEST.title })).toBeNull()
    expect(screen.queryByText(/最新 · LATEST/)).toBeNull()
  })

  it("缺发布时间与作者时不留空位：只摆标题", () => {
    renderHeader({ latest: { id: "7", title: "只有标题的一条" } })

    expect(screen.getByRole("link", { name: "只有标题的一条" })).toBeTruthy()
    // 没有日期就没有日期读数——不拿「更新至 —」之类的占位糊过去。
    expect(screen.queryByText("—")).toBeNull()
  })

  it("检索按标题走：提交时带上当前的输入词", () => {
    const { props } = renderHeader({ keyword: "" })

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "白内障" } })
    fireEvent.submit(screen.getByRole("search"))

    expect(props.onKeywordChange).toHaveBeenCalledWith("白内障")
    expect(props.onSearch).toHaveBeenCalledTimes(1)
  })

  it("只在有检索词时才给清除入口", () => {
    renderHeader({ searching: false })
    expect(screen.queryByRole("button", { name: "清除" })).toBeNull()

    cleanup()
    renderHeader({ searching: true })
    expect(screen.getByRole("button", { name: "清除" })).toBeTruthy()
  })

  it("有真实封面才摆图位：头条是「图 + 文」双栏", () => {
    const { container } = render(
      <MemoryRouter>
        <JournalHeader
          latest={{ ...LATEST, coverImage: "https://example.com/cover.jpg" }}
          keyword=""
          onKeywordChange={vi.fn()}
          onSearch={vi.fn()}
          onClear={vi.fn()}
          searching={false}
        />
      </MemoryRouter>,
    )

    const plate = container.querySelector(".journal__latest-plate")
    expect(plate).toBeTruthy()
    expect(plate?.querySelector("img")?.getAttribute("src")).toBe("https://example.com/cover.jpg")
    // 有图位就不是纯文字那一档。
    expect(container.querySelector(".journal__latest")?.className).not.toContain("is-text")
  })

  it("没有封面就是纯文字排版，不拿占位图补位", () => {
    const { container } = renderHeader({ latest: { ...LATEST, coverImage: undefined } })

    expect(container.querySelector(".journal__latest-plate")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector(".journal__latest")?.className).toContain("is-text")
  })

  it("不编造后端没有的字段：没有分类、没有阅读数、没有精选", () => {
    renderHeader()

    const text = document.body.textContent ?? ""
    for (const fake of ["阅读", "浏览量", "热门", "精选", "推荐", "分类"]) {
      expect(text).not.toContain(fake)
    }
  })
})

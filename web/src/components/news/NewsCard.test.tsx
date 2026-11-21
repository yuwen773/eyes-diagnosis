// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import type { NewsItem } from "@/lib/api"

import { NewsCard } from "./NewsCard"

afterEach(cleanup)

const BASE: NewsItem = {
  id: "1234",
  title: "干眼症的泪膜不稳定与泪液替代疗法",
  publishTime: "2026-11-05 14:00:00",
  content: "<p>干眼症的核心是泪膜不稳定，泪液替代疗法能改善症状，但需要按病因分层。</p>",
}

function renderCard(item: NewsItem = BASE) {
  const { container } = render(
    <MemoryRouter>
      <ul>
        <NewsCard item={item} index={0} />
      </ul>
    </MemoryRouter>,
  )
  return container
}

describe("NewsCard", () => {
  it("只摆接口给的字段：标题、发布时间、正文开头", () => {
    const container = renderCard()

    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy()
    expect(screen.getByText("2026-11-05")).toBeTruthy()
    // 摘要取的是正文开头，不是后端那条常常是标题回声的 summary。
    expect(container.querySelector(".journal-card__excerpt")?.textContent).toContain("泪膜不稳定")
  })

  it("点进去就是这一条详情", () => {
    renderCard()
    expect(screen.getByRole("link").getAttribute("href")).toBe("/news/1234")
  })

  it("没有封面就不摆图位，也不编一张占位图出来", () => {
    const container = renderCard()

    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector(".glare")).toBeNull()
    // 纯文字卡是另一种排版，不是一张没加载出来的图：类名标出来。
    expect(container.querySelector(".journal-card--text")).toBeTruthy()
  })

  it("有真实封面才用封面，并挂上聚光层", () => {
    const container = renderCard({ ...BASE, coverImage: "https://example.com/cover.jpg" })

    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe("https://example.com/cover.jpg")
    expect(container.querySelector(".glare")).toBeTruthy()
    // 有图位的卡才摆摘要——那格里有照片撑着，纯文字格不重复标题的回声。
    expect(container.querySelector(".journal-card__excerpt")?.textContent).toContain("泪膜不稳定")
  })

  it("缺发布时间就不留破折号位", () => {
    const container = renderCard({ ...BASE, publishTime: undefined })

    expect(container.querySelector(".journal-card__date")).toBeNull()
  })

  it("不编造后端没有的字段：没有阅读数、收藏数、分类与作者头衔", () => {
    const container = renderCard({ ...BASE, coverImage: "https://example.com/cover.jpg" })
    const text = container.textContent ?? ""

    for (const fake of ["阅读", "浏览", "收藏", "分类", "编辑精选", "推荐"]) {
      expect(text).not.toContain(fake)
    }
  })
})

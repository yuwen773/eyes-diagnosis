// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { newsWordCount } from "@/lib/news"

import { NewsArticleView } from "./NewsArticleView"

const LONG = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段正文内容用于凑够长文字数。`).join("")

afterEach(cleanup)

/** 期望值直接复用管线里的 newsWordCount，算法不会自己跟自己不一致。 */
const wordCount = newsWordCount

describe("NewsArticleView", () => {
  it("库里的 HTML 先净化：脚本与事件属性到不了 DOM", () => {
    const { container } = render(
      <NewsArticleView
        article={{
          title: "标题",
          content: '<p>正文</p><script>alert(1)</script><p onclick="x()">第二段</p>',
          publishTime: "2026-11-01 09:30:00",
        }}
      />,
    )

    expect(container.innerHTML).not.toContain("<script")
    expect(container.innerHTML).not.toContain("onclick")
    expect(screen.getByText("正文")).toBeTruthy()
  })

  it("Markdown 走公开页同一条管线：标题转成 h2、补锚点、生成目录", () => {
    const { container } = render(
      <NewsArticleView
        article={{ title: "标题", content: "## 第一节\n\n内容一\n\n## 第二节\n\n内容二" }}
        contentFormat="markdown"
      />,
    )

    const headings = container.querySelectorAll(".news-paper__body h2")
    expect(headings).toHaveLength(2)
    expect(headings[0].id).toBe("news-sec-1")
    // 两个章节才值得摆目录；目录链接指向正文锚点。
    expect(screen.getByLabelText("正文目录")).toBeTruthy()
    expect(screen.getByRole("link", { name: /第一节/ }).getAttribute("href")).toBe("#news-sec-1")
  })

  it("长文把首段提出来当导语，正文从第二段开始", () => {
    const { container } = render(
      <NewsArticleView
        article={{ title: "标题", content: `<p>导语第一段。</p><p>${LONG}</p>` }}
      />,
    )

    expect(screen.getByText("导语第一段。")).toBeTruthy()
    expect(container.querySelector(".news-paper__body")?.textContent).not.toContain("导语第一段。")
  })

  it("没有封面就不摆封面位", () => {
    const { container } = render(<NewsArticleView article={{ title: "标题", content: "正文" }} />)
    expect(container.querySelector(".news-article__plate")).toBeNull()
  })

  it("作者缺省值与眉线可由调用方决定：预览不编造发布信息", () => {
    render(
      <NewsArticleView
        article={{ title: "标题", content: "正文" }}
        authorFallback="未署名"
        kicker="预览稿 · 尚未发布"
      />,
    )

    expect(screen.getByText("未署名")).toBeTruthy()
    expect(screen.getByText("预览稿 · 尚未发布")).toBeTruthy()
    expect(screen.queryByText(/发布于/)).toBeNull()
  })

  it("字数按渲染后的全文算：Markdown 源的 # 记号不计入，导语被提走后也不少算", () => {
    // 400 字门槛之上、首段可提取的长文：旧实现数库里原文，Markdown 管线
    // 会剥掉 # ** - 等记号，两种来源都用渲染后文本才是同一口径。
    const md = `## 标题\n\n${Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 段正文。`).join("\n\n")}`
    // 注：标题与正文之间必须有空行，markdown-it 才把它落成 h1。
    const { container } = render(
      <NewsArticleView article={{ title: "标题", content: md }} contentFormat="markdown" />,
    )
    const meta = container.querySelector(".news-article__meta")?.textContent ?? ""
    const rendered = container.querySelector(".news-paper__body")?.textContent ?? ""
    expect(rendered).not.toContain("##")
    // 不变量：读数 = 正文渲染文本 + 被提走的导语（都按 newsWordCount 的
    // 汉字/英文口径数）。本 fixture 无导语、无 h1，标题在正文里。
    const lead = container.querySelector(".news-article__lead")?.textContent ?? ""
    const expected = wordCount(rendered) + wordCount(`<p>${lead}</p>`)
    expect(meta).toContain(`${expected} 字`)
    expect(expected).toBeGreaterThan(400)
  })

  it("HTML 来源的字数与库里原文同口径：净化不剥实体", () => {
    // 公开页旧实现数 item.content（库里存的 HTML）；html 分支必须与之一致。
    const html = `<p>导语段。</p><p>${"正文内容".repeat(120)}</p>`
    const { container } = render(
      <NewsArticleView article={{ title: "标题", content: html }} />,
    )
    const meta = container.querySelector(".news-article__meta")?.textContent ?? ""
    // 期望值 = 正文渲染文本 + 被提走的导语（「导语段。」4 字）。
    const body = container.querySelector(".news-paper__body")?.textContent ?? ""
    const lead = container.querySelector(".news-article__lead")?.textContent ?? ""
    expect(meta).toContain(`${wordCount(body) + wordCount(`<p>${lead}</p>`)} 字`)
  })
})

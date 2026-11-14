// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"

import { DocumentReader } from "./DocumentReader"
import { fetchKnowledgeDocx, fetchKnowledgeText, type KnowledgeDetail } from "@/lib/adminApi"
import { convertToHtml } from "mammoth"
import { ApiError } from "@/lib/api"

vi.mock("@/lib/adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminApi")>()
  return {
    ...actual,
    fetchKnowledgeText: vi.fn(),
    fetchKnowledgeDocx: vi.fn(),
  }
})

vi.mock("mammoth", () => ({ convertToHtml: vi.fn() }))

function detail(overrides: Partial<KnowledgeDetail> = {}): KnowledgeDetail {
  return {
    id: "11",
    title: "文档",
    fileName: "文档.md",
    fileType: "md",
    fileSize: "1024",
    chunkCount: 2,
    status: 1,
    userId: "1",
    createTime: "2026-04-30T15:51:31",
    updateTime: "2026-04-30T15:51:31",
    previewKind: "text",
    chunks: [],
    chunksReadable: true,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.mocked(fetchKnowledgeText).mockReset()
  vi.mocked(fetchKnowledgeDocx).mockReset()
  vi.mocked(convertToHtml).mockReset()
  vi.unstubAllGlobals()
})

/** PDF 探针只看响应头：真正的 PDF 才让 iframe 显示。 */
function stubPdfProbe(contentType: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("", { headers: { "Content-Type": contentType } })),
  )
}

describe("DocumentReader", () => {
  it("PDF 用同源代理地址内嵌，并提供新窗口与下载入口", async () => {
    stubPdfProbe("application/pdf")
    render(<DocumentReader detail={detail({ fileType: "pdf", fileName: "a.pdf" })} />)

    const frame = await screen.findByTitle("a.pdf 原文")
    expect(frame.tagName).toBe("IFRAME")
    expect(frame.getAttribute("src")).toBe("/api/knowledge/11/content")
    expect(screen.getByText("新窗口打开").closest("a")?.getAttribute("href")).toBe(
      "/api/knowledge/11/content",
    )
    // 下载入口只保留一处（工作区头部）；阅读区不再重复一遍。
    expect(screen.queryByText("下载原文件")).toBeNull()
    expect(screen.getByText("PDF 载入中…")).toBeTruthy()
  })

  it("拿到的不是 PDF 时不摆查看器角标，如实说没拿到 PDF", async () => {
    stubPdfProbe("application/json")
    render(<DocumentReader detail={detail({ fileType: "pdf", fileName: "a.pdf" })} />)

    // 鉴权过期时端点回的是 JSON 错误信封：角标不能说「浏览器内嵌查看器」。
    expect(await screen.findByText("没有拿到 PDF 内容（登录可能已过期）")).toBeTruthy()
    expect(screen.queryByTitle("a.pdf 原文")).toBeNull()
  })

  it("Markdown 走富文本渲染：标题与列表可见", async () => {
    vi.mocked(fetchKnowledgeText).mockResolvedValueOnce("## 疾病概述\n\n- 条目一\n- 条目二")
    const { container } = render(<DocumentReader detail={detail()} />)

    await waitFor(() => {
      expect(container.querySelector(".admin-doc__prose h2")?.textContent).toBe("疾病概述")
    })
    expect(container.querySelectorAll(".admin-doc__prose li")).toHaveLength(2)
  })

  it("TXT 原样展示，不做 Markdown 渲染", async () => {
    vi.mocked(fetchKnowledgeText).mockResolvedValueOnce("### 不是标题\n\n普通一行")
    render(<DocumentReader detail={detail({ fileType: "txt", fileName: "a.txt" })} />)

    const pre = await screen.findByText(/### 不是标题/)
    expect(pre.tagName).toBe("PRE")
  })

  it("DOCX 在浏览器内转换后注入净化过的 HTML", async () => {
    vi.mocked(fetchKnowledgeDocx).mockResolvedValueOnce(new ArrayBuffer(8))
    vi.mocked(convertToHtml).mockResolvedValueOnce({
      value: "<h1>章节</h1><p>正文</p><script>alert(1)</script>",
      messages: [],
    })
    const { container } = render(
      <DocumentReader detail={detail({ fileType: "docx", fileName: "a.docx" })} />,
    )

    await waitFor(() => {
      expect(container.querySelector(".admin-doc__prose h1")?.textContent).toBe("章节")
    })
    expect(container.innerHTML).not.toContain("<script")
    expect(screen.getByText("DOCX · 浏览器内解析")).toBeTruthy()
  })

  it("DOC 明确说明不支持在线预览，只给下载", () => {
    render(<DocumentReader detail={detail({ fileType: "doc", fileName: "a.doc" })} />)

    expect(screen.getByText("暂不支持在线预览 DOC")).toBeTruthy()
    expect(screen.getByText(/旧版二进制 Word 格式/)).toBeTruthy()
    expect(screen.getByText("下载原文件").closest("a")?.getAttribute("href")).toBe(
      "/api/knowledge/11/content?download=1",
    )
    expect(fetchKnowledgeText).not.toHaveBeenCalled()
    expect(fetchKnowledgeDocx).not.toHaveBeenCalled()
  })

  it("原文读取失败显示错误态，而不是空白", async () => {
    vi.mocked(fetchKnowledgeText).mockRejectedValueOnce(new ApiError(-1, "网络不可用"))
    render(<DocumentReader detail={detail()} />)

    await screen.findByText("连不上服务，请检查网络后再试一次。")
  })
})

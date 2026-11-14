// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { documentRenderKind, renderDocxHtml, renderMarkdownDocument } from "./documentPreview"
import { convertToHtml } from "mammoth"

/**
 * mammoth 的解析本身属于第三方库行为，单测只钉我们这一层：
 * 转换结果必须过一次白名单净化、异常必须抛给调用方（由阅读器显示失败态）。
 * 真实 DOCX 的端到端渲染由 Playwright 用例覆盖。
 */
vi.mock("mammoth", () => ({ convertToHtml: vi.fn() }))

afterEach(() => {
  vi.mocked(convertToHtml).mockReset()
})

describe("documentRenderKind", () => {
  it("按文件类型给出渲染器分支", () => {
    expect(documentRenderKind("pdf")).toBe("pdf")
    expect(documentRenderKind("txt")).toBe("text")
    expect(documentRenderKind("md")).toBe("markdown")
    expect(documentRenderKind("markdown")).toBe("markdown")
    expect(documentRenderKind("docx")).toBe("docx")
    expect(documentRenderKind("doc")).toBe("none")
    expect(documentRenderKind(undefined)).toBe("none")
  })

  it("类型大小写不敏感", () => {
    expect(documentRenderKind("PDF")).toBe("pdf")
    expect(documentRenderKind("DOCX")).toBe("docx")
  })
})

describe("renderMarkdownDocument", () => {
  it("上传文档里的远程图片不放行：不给第三方做像素级追踪", () => {
    const html = renderMarkdownDocument(
      "![追踪](https://third.example/track.gif)\n\n![内嵌](data:image/png;base64,AAAA)",
    )

    // 文档是外部来源：远程图片会把管理员的浏览器引到第三方。
    expect(html).not.toContain("track.gif")
    expect(html).not.toContain("third.example")
    // 内嵌图（data:）留着——它不发外联请求。
    expect(html).toContain("data:image/png;base64,AAAA")
  })

  it("渲染 Markdown 结构（标题 / 列表 / 表格 / 代码块）", () => {
    const html = renderMarkdownDocument([
      "# 标题",
      "",
      "- 条目一",
      "- 条目二",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```python",
      "print('hi')",
      "```",
    ].join("\n"))

    expect(html).toContain("<h1>")
    expect(html).toContain("<li>")
    expect(html).toContain("<table>")
    expect(html).toContain("<pre")
  })

  it("原始 HTML 被转义成文字，不生成标签", () => {
    const html = renderMarkdownDocument(
      '正常文字\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">',
    )
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("<img")
    // 转义后的文字仍在，说明这是「按原文显示」，不是静默丢弃。
    expect(html).toContain("&lt;script&gt;")
  })

  it("危险链接协议不会生成可点击链接", () => {
    const html = renderMarkdownDocument("[点我](javascript:alert(1))")
    expect(html).not.toContain('href="javascript')
  })
})

describe("renderDocxHtml", () => {
  it("转换结果过一次白名单净化（脚本 / 事件处理器不进入 DOM）", async () => {
    vi.mocked(convertToHtml).mockResolvedValueOnce({
      value:
        '<h1>章节标题</h1><p>正文段落。</p><script>alert(1)</script>' +
        '<img src=x onerror="alert(1)">',
      messages: [],
    })

    const html = await renderDocxHtml(new ArrayBuffer(8))
    expect(html).toContain("章节标题")
    expect(html).toContain("正文段落。")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("onerror")
  })

  it("转换失败原样抛给调用方（阅读器据此显示失败态）", async () => {
    vi.mocked(convertToHtml).mockRejectedValueOnce(new Error("not a docx"))
    await expect(renderDocxHtml(new ArrayBuffer(8))).rejects.toThrow("not a docx")
  })
})

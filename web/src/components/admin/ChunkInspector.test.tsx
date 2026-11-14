// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { ChunkInspector } from "./ChunkInspector"
import type { KnowledgeDetail } from "@/lib/adminApi"

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
    chunks: [
      { index: 0, text: "第一块切片内容", chars: 7 },
      { index: 1, text: "第二块切片内容", chars: 7 },
    ],
    chunksReadable: true,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ChunkInspector", () => {
  it("按序号列出切片，并显示每块字符数", () => {
    render(<ChunkInspector detail={detail()} />)

    expect(screen.getByText("CHUNK 00")).toBeTruthy()
    expect(screen.getByText("CHUNK 01")).toBeTruthy()
    expect(screen.getAllByText("7 字")).toHaveLength(2)
    expect(screen.getByText("共 2 块")).toBeTruthy()
  })

  it("折叠后隐藏正文，再点一次展开", () => {
    render(<ChunkInspector detail={detail()} />)

    const toggle = screen.getByRole("button", { name: /CHUNK 00/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("第一块切片内容")).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText("第一块切片内容")).toBeTruthy()
  })

  it("复制切片调用剪贴板并给出回执", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })

    render(<ChunkInspector detail={detail()} />)
    fireEvent.click(screen.getByRole("button", { name: "复制第 0 块切片" }))

    await screen.findByText("已复制")
    expect(writeText).toHaveBeenCalledWith("第一块切片内容")
  })

  it("读取失败与「切片为 0」是两种结论，不混为一谈", () => {
    const { rerender } = render(
      <ChunkInspector detail={detail({ chunksReadable: false, chunksMessage: "文件已不在存储里" })} />,
    )
    expect(screen.getByText("文件已不在存储里")).toBeTruthy()
    expect(screen.getByText(/不是「切片为 0」/)).toBeTruthy()

    rerender(<ChunkInspector detail={detail({ chunks: [] })} />)
    expect(screen.getByText("该文档没有切片。")).toBeTruthy()
  })

  it("入库计数与重放结果不一致时如实说明，不声称一一对应", () => {
    render(<ChunkInspector detail={detail({ chunkCount: 5 })} />)

    expect(screen.getByText("入库时 5 块，按当前规则重放 2 块")).toBeTruthy()
    expect(screen.queryByText("每条与向量库序号一一对应")).toBeNull()
  })

  it("DOC 的不可读原因不冒充扫描件", () => {
    render(
      <ChunkInspector
        detail={detail({
          fileType: "doc",
          chunksReadable: false,
          chunksMessage: "文档正文为空：扫描件或没有可提取的文字层",
        })}
      />,
    )

    expect(screen.getByText(/DOC 不做在线解析/)).toBeTruthy()
    expect(screen.queryByText(/扫描件/)).toBeNull()
  })

  it("切片很多时分批显示，不一次铺满", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      index,
      text: `切片 ${index}`,
      chars: 4,
    }))
    render(<ChunkInspector detail={detail({ chunks: many })} />)

    expect(screen.getAllByText(/^CHUNK \d+$/)).toHaveLength(30)
    fireEvent.click(screen.getByRole("button", { name: /再显示/ }))
    expect(screen.getAllByText(/^CHUNK \d+$/)).toHaveLength(45)
  })
})

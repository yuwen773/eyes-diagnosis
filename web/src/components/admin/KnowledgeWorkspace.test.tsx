// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { chunkSummary } from "./KnowledgeWorkspace"
import type { KnowledgeDetail } from "@/lib/adminApi"

function detail(overrides: Partial<KnowledgeDetail> = {}): KnowledgeDetail {
  return {
    id: "49",
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

describe("知识库工作区头部读数", () => {
  it("入库计数与重放一致时只报块数", () => {
    expect(chunkSummary(detail())).toBe("2 块切片")
  })

  it("入库计数与重放不一致时带口径", () => {
    expect(chunkSummary(detail({ chunkCount: 11 }))).toBe("2 块 · 当前规则重放")
  })

  it("触到重放上限时，块数读数必须带限定语", () => {
    // 截断时这个数是「显示出来的数」：裸着一个「2000 块」会让人以为全部只有
    // 2000 块——三处读数里只有限定过一处，另外两处是裸数。
    expect(chunkSummary(detail({ chunkCount: 2000, chunksTruncated: true }))).toContain("已达上限")
    expect(chunkSummary(detail({ chunkCount: 11, chunksTruncated: true }))).toContain("已达上限")
    // 处理中与不可读本来就不报块数，不受截断影响。
    expect(chunkSummary(detail({ status: 0, chunksTruncated: true }))).toBe("切片处理中")
  })

  it("未入库与不可读各有各的说法，不冒充块数", () => {
    expect(chunkSummary(detail({ status: 0 }))).toBe("切片处理中")
    expect(chunkSummary(detail({ chunksReadable: false }))).toBe("切片不可读")
  })
})

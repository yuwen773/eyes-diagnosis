import { describe, expect, it } from "vitest"
import { filterImageFiles } from "./agentUpload"

const mkFile = (name: string, type: string, size: number) => {
  const f = new File(["x"], name, { type, lastModified: 1 })
  Object.defineProperty(f, "size", { value: size })
  return f
}

describe("filterImageFiles", () => {
  it("只保留图片类型", () => {
    const png = mkFile("a.png", "image/png", 100)
    const pdf = mkFile("b.pdf", "application/pdf", 100)
    const out = filterImageFiles([png, pdf])
    expect(out).toEqual([png])
  })

  it("超过大小上限的丢弃", () => {
    const big = mkFile("big.png", "image/png", 20 * 1024 * 1024)
    const small = mkFile("s.png", "image/png", 1024)
    expect(filterImageFiles([big, small])).toEqual([small])
  })

  it("类型为空但有图片扩展名也放行（部分浏览器剪贴板不给 MIME）", () => {
    const f = mkFile("c.jpg", "", 1024)
    expect(filterImageFiles([f])).toEqual([f])
  })

  it("空数组原样返回", () => {
    expect(filterImageFiles([])).toEqual([])
  })
})

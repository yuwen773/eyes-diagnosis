import { describe, expect, it } from "vitest"
import { extractResources } from "./agentResources"

const EMPTY = { images: [], links: [] }

describe("extractResources", () => {
  it("提取 markdown 图片", () => {
    const r = extractResources("看 ![眼底图](https://cos.example.com/fundus.jpg) 结果", EMPTY)
    expect(r.images).toEqual([{ url: "https://cos.example.com/fundus.jpg", title: "眼底图" }])
    expect(r.links).toEqual([])
  })
  it("提取非图片链接且排除图片语法（Vue 版 (?!!) bug 的回归测试）", () => {
    const r = extractResources(
      "参考 [指南](https://med.org/guide) 与 ![图](https://cos.example.com/a.jpg)",
      EMPTY,
    )
    expect(r.links.map((l) => l.url)).toEqual(["https://med.org/guide"])
    expect(r.images.map((i) => i.url)).toEqual(["https://cos.example.com/a.jpg"])
  })
  it("累积时按 URL 去重", () => {
    const one = extractResources("![a](https://x/1.jpg)", EMPTY)
    const two = extractResources("![a](https://x/1.jpg)", one)
    expect(two.images).toHaveLength(1)
  })
  it("无效 URL 不产生链接条目", () => {
    const r = extractResources("[坏](::::not-a-url)", EMPTY)
    expect(r.links).toEqual([])
  })
})

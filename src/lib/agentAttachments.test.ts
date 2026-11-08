import { describe, expect, it } from "vitest"
import { addFiles, removeById, type Attachment } from "./agentAttachments"

const mkFile = (name: string) => new File(["x"], name, { lastModified: 1 })

const urlFor = (file: File) => `blob:${file.name}`

describe("agentAttachments", () => {
  it("添加文件生成带 url 的附件项", () => {
    const out = addFiles([], [mkFile("a.png")], urlFor)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe("a.png")
    expect(out[0].url).toBe("blob:a.png")
    expect(out[0].id).toBeTruthy()
  })

  it("删除某项后其余项的 url 与自己保持绑定（错位回归测试）", () => {
    const added = addFiles([], [mkFile("a.png"), mkFile("b.png")], urlFor)
    const removed = removeById(added, added[0].id)
    expect(removed).toHaveLength(1)
    expect(removed[0].name).toBe("b.png")
    expect(removed[0].url).toBe("blob:b.png")
  })

  it("删除不存在的 id 不改变列表", () => {
    const added = addFiles([], [mkFile("a.png")], urlFor)
    expect(removeById(added, "nope")).toEqual(added)
  })

  it("同名文件各自独立（id 不冲突，url 各自绑定）", () => {
    const added = addFiles([], [mkFile("a.png"), mkFile("a.png")], urlFor)
    expect(added).toHaveLength(2)
    expect(added[0].id).not.toBe(added[1].id)
    expect(removeById(added, added[0].id)[0].url).toBe(added[1].url)
  })

  it("类型：Attachment 只暴露组件需要的字段", () => {
    const one: Attachment = { id: "1", name: "x", url: "blob:x", file: mkFile("x") }
    expect(one.name).toBe("x")
    expect(one.file.name).toBe("x")
  })
})

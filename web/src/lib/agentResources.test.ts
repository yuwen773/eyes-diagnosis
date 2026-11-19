import { describe, expect, it } from "vitest"

import {
  countResources,
  deriveResources,
  evidenceKeyOf,
  isAutoLoadableImage,
  isTrustedAttachmentUrl,
  parseResourceRefs,
  type AgentResource,
  type ResourceSourceMessage,
} from "./agentResources"

function msg(partial: Partial<ResourceSourceMessage> & { type: string }): ResourceSourceMessage {
  return { id: partial.id ?? `m-${Math.random().toString(36).slice(2)}`, content: "", ...partial }
}

describe("deriveResources —— 影像", () => {
  it("用户上传的图片登记为 upload 来源", () => {
    const r = deriveResources([
      msg({
        type: "user",
        content: "看看这张",
        images: ["/api/agent/image/view/a.jpg", "/api/agent/image/view/b.jpg"],
      }),
    ])
    expect(r.images.map((i) => i.url)).toEqual([
      "/api/agent/image/view/a.jpg",
      "/api/agent/image/view/b.jpg",
    ])
    expect(r.images.every((i) => i.source === "upload")).toBe(true)
    expect(r.documents).toEqual([])
    expect(r.links).toEqual([])
  })

  it("助手把同一张上传图再贴一遍时不重复，也不改写它的出处", () => {
    const r = deriveResources([
      msg({ type: "user", content: "看图", images: ["/api/agent/image/view/a.jpg"] }),
      msg({ type: "assistant", content: "这是你的图 ![原图](/api/agent/image/view/a.jpg)" }),
    ])
    expect(r.images).toHaveLength(1)
    expect(r.images[0].source).toBe("upload")
  })

  it("助手正文里的图片按 assistant 出处登记", () => {
    const r = deriveResources([
      msg({ type: "assistant", content: "参考 ![眼底图](https://cdn.example.com/f.png)" }),
    ])
    expect(r.images).toEqual([
      expect.objectContaining({
        url: "https://cdn.example.com/f.png",
        title: "眼底图",
        source: "assistant",
      }),
    ])
  })

  it("非 http(s) 图片地址一律拒绝", () => {
    const r = deriveResources([
      msg({
        type: "user",
        images: ["javascript:alert(1)", "data:image/png;base64,AAA", "//evil.example.com/x.png"],
      }),
    ])
    expect(r.images).toEqual([])
  })
})

describe("deriveResources —— 链接", () => {
  it("提取普通链接并排除图片语法（Vue 版 (?!!) bug 的回归测试）", () => {
    const r = deriveResources([
      msg({
        type: "assistant",
        content: "参考 [指南](https://med.org/guide) 与 ![图](https://cos.example.com/a.jpg)",
      }),
    ])
    expect(r.links.map((l) => l.url)).toEqual(["https://med.org/guide"])
    expect(r.links[0]).toMatchObject({ title: "指南", domain: "med.org", source: "assistant" })
    expect(r.images.map((i) => i.url)).toEqual(["https://cos.example.com/a.jpg"])
  })

  it("拒绝 javascript: / data: / mailto: 等非 http(s) 协议", () => {
    const r = deriveResources([
      msg({
        type: "assistant",
        content:
          "[坏](javascript:alert(1)) [邮件](mailto:a@b.com) [数据](data:text/html,x) [好](https://ok.example.com)",
      }),
    ])
    expect(r.links.map((l) => l.url)).toEqual(["https://ok.example.com/"])
  })

  it("带用户名密码的 URL 不当作普通链接", () => {
    const r = deriveResources([
      msg({ type: "assistant", content: "[x](https://user:pass@evil.example.com/a)" }),
    ])
    expect(r.links).toEqual([])
  })

  it("同一链接在正文里多次出现只登记一次，且忽略 # 锚点差异", () => {
    const r = deriveResources([
      msg({
        type: "assistant",
        content: "[A](https://med.org/x#top) 与 [B](https://med.org/x#section)",
      }),
      msg({ type: "tool-response", content: "[C](https://med.org/x)" }),
    ])
    expect(r.links).toHaveLength(1)
    expect(r.links[0].source).toBe("assistant")
  })

  it("工具返回里的链接标 tool 出处", () => {
    const r = deriveResources([
      msg({ type: "tool-response", content: "详见 [原文](https://journal.example.com/p/1)" }),
    ])
    expect(r.links[0]).toMatchObject({ source: "tool", domain: "journal.example.com" })
  })
})

describe("deriveResources —— 知识来源", () => {
  const ref: AgentResource = {
    id: "doc:42",
    kind: "document",
    title: "干眼症诊疗共识",
    source: "knowledge-base",
    documentId: "42",
    score: 0.81,
    snippet: "睑板腺功能障碍是干眼的主要原因之一。",
    toolCallId: "call-1",
  }

  it("后端下发的结构化引用被登记，并保留相关度与片段", () => {
    const r = deriveResources([msg({ type: "tool-response", resources: [ref] })])
    expect(r.documents).toEqual([expect.objectContaining({ documentId: "42", score: 0.81 })])
    expect(r.documents[0].snippet).toContain("睑板腺")
    expect(r.documents[0].toolCallId).toBe("call-1")
  })

  it("普通链接不会被当成医学证据", () => {
    const r = deriveResources([
      msg({ type: "assistant", content: "参考 [指南](https://med.org/guide)" }),
      msg({ type: "tool-response", resources: [ref] }),
    ])
    expect(r.documents).toHaveLength(1)
    expect(r.links.every((l) => l.kind === "link")).toBe(true)
  })

  it("正文里写得像文献的 Markdown 不会变成知识来源", () => {
    const r = deriveResources([
      msg({
        type: "assistant",
        content: "参考《中华眼科杂志 2023;59(1):12-18》与 [原文](https://journal.example.com/a)",
      }),
    ])
    expect(r.documents).toEqual([])
  })

  it("缺 documentId 的资源被丢弃（不可核验就不展示）", () => {
    const parsed = parseResourceRefs([
      { kind: "document", title: "无标识片段", score: 0.9 },
      { kind: "document", documentId: "7", title: "有标识" },
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].documentId).toBe("7")
  })

  it("片段级来源：保留 chunkId / chunkIndex，并给出可核验的证据键", () => {
    const [parsed] = parseResourceRefs([
      {
        kind: "document",
        documentId: "42",
        chunkId: "doc_42_abc_chunk_3",
        chunkIndex: 3,
        title: "干眼症诊疗共识",
      },
    ])
    expect(parsed.chunkId).toBe("doc_42_abc_chunk_3")
    expect(parsed.chunkIndex).toBe(3)
    expect(parsed.id).toBe("doc:42#3")
    expect(evidenceKeyOf(parsed)).toBe("42#3")
  })

  it("同一文档的两段是两个来源，不被去重折叠成一条", () => {
    const r = deriveResources([
      msg({
        type: "tool-response",
        resources: [
          { id: "doc:42#0", kind: "document", title: "共识", source: "knowledge-base", documentId: "42", chunkIndex: 0 },
          { id: "doc:42#1", kind: "document", title: "共识", source: "knowledge-base", documentId: "42", chunkIndex: 1 },
        ],
      }),
    ])
    expect(r.documents.map((d) => d.id)).toEqual(["doc:42#0", "doc:42#1"])
  })

  it("没有片段序号的文档级来源可以展示，但不构成证据键", () => {
    const [parsed] = parseResourceRefs([{ kind: "document", documentId: "42", title: "共识" }])
    expect(parsed.id).toBe("doc:42")
    expect(evidenceKeyOf(parsed)).toBeNull()
    expect(evidenceKeyOf({ ...parsed, kind: "link", chunkIndex: 0, url: "https://x.test" })).toBeNull()
  })
})

describe("deriveResources —— 回合与定位", () => {
  it("按用户提问切回合，资源带上所属回合与消息 id", () => {
    const r = deriveResources([
      msg({ id: "u1", type: "user", content: "第一问", images: ["/api/agent/image/view/a.jpg"] }),
      msg({ id: "a1", type: "assistant", content: "回答" }),
      msg({ id: "u2", type: "user", content: "第二问" }),
      msg({ id: "a2", type: "assistant", content: "[链接](https://x.example.com/p)" }),
    ])
    expect(r.images[0].round).toBe(1)
    expect(r.images[0].messageId).toBe("u1")
    expect(r.links[0].round).toBe(2)
    expect(r.links[0].messageId).toBe("a2")
  })

  it("多会话/多回合的重复资源只登记一次，跨会话互不串数据", () => {
    const sessionA = deriveResources([
      msg({ type: "assistant", content: "[x](https://same.example.com/p)" }),
    ])
    const sessionB = deriveResources([
      msg({ type: "assistant", content: "[x](https://same.example.com/p)" }),
    ])
    // 各自独立派生，不会因为 A 出现过就丢 B 的
    expect(sessionA.links).toHaveLength(1)
    expect(sessionB.links).toHaveLength(1)
  })

  it("空会话派生空资源", () => {
    const r = deriveResources([])
    expect(countResources(r)).toBe(0)
  })
})

describe("isAutoLoadableImage", () => {
  it("上传影像自动加载", () => {
    expect(
      isAutoLoadableImage({
        id: "image:/api/agent/image/view/a.jpg",
        kind: "image",
        title: "上传的影像",
        source: "upload",
        url: "/api/agent/image/view/a.jpg",
      }),
    ).toBe(true)
  })

  it("第三方图片不自动加载（避免把访问行为泄露给外站）", () => {
    expect(
      isAutoLoadableImage({
        id: "image:https://cdn.third.com/a.png",
        kind: "image",
        title: "外部图",
        source: "assistant",
        url: "https://cdn.third.com/a.png",
      }),
    ).toBe(false)
  })

  it("站内相对路径自动加载", () => {
    expect(
      isAutoLoadableImage({
        id: "image:/uploads/a.png",
        kind: "image",
        title: "站内图",
        source: "tool",
        url: "/uploads/a.png",
      }),
    ).toBe(true)
  })
})

describe("isTrustedAttachmentUrl", () => {
  it("仅上传形状的 COS 地址不再证明附件身份", () => {
    expect(isTrustedAttachmentUrl("https://cos.example.com/agent-chat/7/a.png")).toBe(false)
  })

  it("只有同源授权资源入口可以当附件", () => {
    expect(isTrustedAttachmentUrl("/uploads/a.png")).toBe(false)
    expect(isTrustedAttachmentUrl("/api/agent/image/view/a.png")).toBe(true)
  })

  it("第三方 https 地址不获得附件身份", () => {
    expect(isTrustedAttachmentUrl("https://tracker.example.net/pixel.png")).toBe(false)
    // 路径里带上 agent-chat 也不能冒充：上传地址固定落在对象键根下，
    // 但真正拦住它的是第一道闸（信封标记），这里只是不额外放行第三方域名
    expect(isTrustedAttachmentUrl("https://tracker.example.net/x?p=/agent-chat/7/a.png")).toBe(false)
  })

  it("协议相对地址与反斜杠地址一律拒绝", () => {
    expect(isTrustedAttachmentUrl("//tracker.example.net/pixel.png")).toBe(false)
    expect(isTrustedAttachmentUrl("\\\\tracker.example.net\\pixel.png")).toBe(false)
  })

  it("非 http(s) 协议拒绝", () => {
    expect(isTrustedAttachmentUrl("javascript:alert(1)")).toBe(false)
    expect(isTrustedAttachmentUrl("data:image/png;base64,AAAA")).toBe(false)
  })
})

describe("parseResourceRefs", () => {
  it("非数组输入返回空数组", () => {
    expect(parseResourceRefs(undefined)).toEqual([])
    expect(parseResourceRefs({})).toEqual([])
  })

  it("链接协议不合法时丢弃", () => {
    expect(parseResourceRefs([{ kind: "link", url: "javascript:alert(1)" }])).toEqual([])
  })

  it("图片缺 url 时丢弃", () => {
    expect(parseResourceRefs([{ kind: "image", title: "无地址" }])).toEqual([])
  })
})

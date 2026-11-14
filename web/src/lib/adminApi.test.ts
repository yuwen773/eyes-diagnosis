// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { AUTH_EXPIRED_EVENT } from "./http"
import { fetchKnowledgeText } from "./adminApi"

function stubJson(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  )
}

function stubRaw(body: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      new Response(body, { status, headers: { "Content-Type": "text/plain" } }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("fetchKnowledgeText", () => {
  it("错误信封（数值 code 且非 0）按错误处理，并广播未登录事件", async () => {
    stubJson({ code: 40100, msg: "请先登录" })
    const codes: number[] = []
    const onExpired = (event: Event) => {
      codes.push((event as CustomEvent<{ code: number }>).detail.code)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)

    await expect(fetchKnowledgeText("42")).rejects.toMatchObject({ code: 40100 })
    expect(codes).toEqual([40100])

    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  })

  it("JSON 正文不算错误：code=0 时照常返回内容", async () => {
    // 「响应是 JSON」不等于「出错了」——端点将来可以合法返回 JSON 正文，
    // 那时阅读器应该拿到正文，而不是一律显示「服务返回…」。
    stubJson({ code: 0, data: { text: "正文" } })
    await expect(fetchKnowledgeText("42")).resolves.toContain("正文")
  })

  it("非 JSON 的错误状态按状态码报", async () => {
    stubRaw("boom", 502)
    await expect(fetchKnowledgeText("42")).rejects.toMatchObject({ code: 502 })
  })

  it("非 JSON 的正常响应按原文返回", async () => {
    stubRaw("## 标题")
    await expect(fetchKnowledgeText("42")).resolves.toBe("## 标题")
  })
})

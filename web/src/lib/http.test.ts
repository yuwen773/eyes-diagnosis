// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./api-error"
import { AUTH_EXPIRED_EVENT, request, toPage } from "./http"

type Envelope = { code?: number; data?: unknown; msg?: string }

function stubFetch(payload: Envelope, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function listenAuthExpired() {
  const codes: number[] = []
  const onExpired = (event: Event) => {
    codes.push((event as CustomEvent<{ code: number }>).detail.code)
  }
  window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
  return { codes, stop: () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("request", () => {
  it("解出信封里的 data", async () => {
    stubFetch({ code: 0, data: { ok: true } })
    await expect(request<{ ok: boolean }>("/x")).resolves.toEqual({ ok: true })
  })

  it("网络失败翻成可读的错误，而不是原始 TypeError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("failed"))))
    await expect(request("/x")).rejects.toMatchObject({ code: -1 })
  })

  it("40100 与 40101 都广播——跳不跳由路由层按登录态决定", async () => {
    const { codes, stop } = listenAuthExpired()
    stubFetch({ code: 40100, msg: "未登录" })
    await expect(request("/x")).rejects.toBeInstanceOf(ApiError)
    stubFetch({ code: 40101, msg: "无权限" })
    await expect(request("/x")).rejects.toBeInstanceOf(ApiError)
    stop()

    expect(codes).toEqual([40100, 40101])
  })

  it("silentAuth 不广播（匿名探测是正常结果）", async () => {
    const { codes, stop } = listenAuthExpired()
    stubFetch({ code: 40100, msg: "未登录" })
    await expect(request("/x", {}, { silentAuth: true })).rejects.toBeInstanceOf(ApiError)
    stop()

    expect(codes).toEqual([])
  })

  it("FormData 不强行写 Content-Type，交给浏览器带 boundary", async () => {
    const fetchMock = stubFetch({ code: 0, data: "url" })
    const form = new FormData()
    form.append("file", new Blob(["x"]), "a.png")

    await request<string>("/upload", { method: "POST", body: form })

    const init = fetchMock.mock.calls[0][1]
    expect((init?.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined()
  })

  it("业务错误保留后端文案与错误码", async () => {
    stubFetch({ code: 40001, msg: "请求数据不存在" })
    await expect(request("/x")).rejects.toMatchObject({
      code: 40001,
      message: "请求数据不存在",
    })
  })

  it("调用方取消请求时原样抛出 AbortError，不翻成「网络不可用」", async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort()
        throw new DOMException("The operation was aborted.", "AbortError")
      }),
    )

    await expect(request("/x", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
  })

  it("把调用方的 AbortSignal 原样交给 fetch（取消才真的能停下请求）", async () => {
    const fetchMock = stubFetch({ code: 0, data: { ok: true } })
    const controller = new AbortController()

    await request<{ ok: boolean }>("/x", { signal: controller.signal })

    const init = fetchMock.mock.calls[0][1]
    expect(init?.signal).toBe(controller.signal)
    expect(init?.credentials).toBe("include")
  })
})

describe("toPage", () => {
  it("把字符串计数转回 number", () => {
    expect(
      toPage({ records: [], total: "13", size: "10", current: "1", pages: "2" }),
    ).toEqual({ records: [], total: 13, size: 10, current: 1, pages: 2 })
  })
})

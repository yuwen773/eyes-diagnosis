// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AUTH_EXPIRED_EVENT, getLoginUser, getSessions, streamChat } from "./api"

let calls: number
let codes: number[]
let handler: (event: Event) => void

beforeEach(() => {
  calls = 0
  codes = []
  handler = (event) => {
    calls += 1
    codes.push((event as CustomEvent<{ code: number }>).detail?.code ?? 0)
  }
  window.addEventListener(AUTH_EXPIRED_EVENT, handler)
})

afterEach(() => {
  window.removeEventListener(AUTH_EXPIRED_EVENT, handler)
  vi.unstubAllGlobals()
})

function stubEnvelope(code: number, msg = "") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code, data: null, msg }),
    }),
  )
}

describe("未登录处理", () => {
  it("业务接口返回 40100 时广播未登录事件（供路由跳登录页）", async () => {
    stubEnvelope(40100, "未登录")
    await expect(getSessions()).rejects.toThrow()
    expect(calls).toBe(1)
    expect(codes).toEqual([40100])
  })

  it("会话探测（getLoginUser）返回 40100 不广播——匿名访问是常态，不能把人一脚踢去登录", async () => {
    stubEnvelope(40100, "未登录")
    await expect(getLoginUser()).rejects.toThrow()
    expect(calls).toBe(0)
  })

  it("其它错误码不广播", async () => {
    stubEnvelope(40000, "条件不对")
    await expect(getSessions()).rejects.toThrow()
    expect(calls).toBe(0)
  })

  it("SSE 端点回的是 JSON 错误信封（匿名时后端抛 NO_AUTH_ERROR）时也广播未登录", async () => {
    // 未登录时 /agent/chat/stream 不是 SSE，而是 200 + {code:40101}
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ code: 40101, data: null, msg: "会话标识或用户为空" }),
        text: async () => JSON.stringify({ code: 40101, data: null, msg: "会话标识或用户为空" }),
      }),
    )

    await expect(
      streamChat({ message: "你好", threadId: "t-1" }, {
        onEvent: () => {},
        onDone: () => {},
        onError: () => {},
      }, new AbortController().signal),
    ).rejects.toThrow()

    expect(calls).toBe(1)
    expect(codes).toEqual([40101])
  })
})

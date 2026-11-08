// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AUTH_EXPIRED_EVENT, getLoginUser, getSessions } from "./api"

let handler: (event: Event) => void
let calls: number

beforeEach(() => {
  calls = 0
  handler = () => {
    calls += 1
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
})

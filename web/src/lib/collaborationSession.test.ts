// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { createAgentSession } from "./api"

afterEach(() => vi.unstubAllGlobals())
it("协作会话创建沿用HTTP层，发送sessionId及取消信号，禁止缓存", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({
        code: 0,
        data: { sessionId: "synthetic-session" },
        msg: "ok",
      })
    )
  vi.stubGlobal("fetch", fetch)
  const controller = new AbortController()
  expect(
    await createAgentSession("synthetic-session", controller.signal)
  ).toEqual({ sessionId: "synthetic-session" })
  expect(fetch).toHaveBeenCalledWith(
    "/api/agent/sessions",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sessionId: "synthetic-session" }),
      signal: controller.signal,
      cache: "no-store",
      credentials: "include",
    })
  )
})

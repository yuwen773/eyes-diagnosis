import { afterEach, expect, it, vi } from "vitest"
import { getChatHistory, getSessions } from "./api"
afterEach(() => vi.unstubAllGlobals())
it("normalizes actual Java Date timestamps before the session list receives them", async () => {
  const timestamp = 1794412800000
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: [
            {
              sessionId: "real-thread",
              title: "影像协作",
              createdTime: timestamp,
              updatedTime: timestamp,
            },
          ],
        })
      )
    )
  )
  const sessions = await getSessions()
  expect(sessions[0].updatedTime).toBe(new Date(timestamp).toISOString())
  expect(sessions[0].createdTime).toBe(new Date(timestamp).toISOString())
  expect(sessions[0].sessionId).toBe("real-thread")
})
it("keeps existing ISO/local string dates compatible", async () => {
  const date = "2026-11-12 01:00:00"
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: [
            { sessionId: "old-thread", createdTime: date, updatedTime: date },
          ],
        })
      )
    )
  )
  expect((await getSessions())[0].updatedTime).toBe(date)
})
it("normalizes real Java message dates without changing cursor or message identity", async () => {
  const timestamp = 1794412800000
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            messages: [
              {
                id: "2120565650562129921",
                role: "USER",
                content: "Historical text",
                createdTime: timestamp,
              },
            ],
            hasMore: true,
            nextCursor: "2120565650562129921",
          },
        })
      )
    )
  )
  const history = await getChatHistory("thread")
  expect(history.messages[0].createdTime).toBe(
    new Date(timestamp).toISOString()
  )
  expect(history.messages[0].id).toBe("2120565650562129921")
  expect(history.nextCursor).toBe("2120565650562129921")
})

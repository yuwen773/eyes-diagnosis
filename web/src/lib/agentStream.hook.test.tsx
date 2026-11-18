// @vitest-environment jsdom
/**
 * useAgentStream 的 hook 级测试。
 *
 * <p>页面测试把 hook 整个 mock 掉了，等于用「假 hook」证明「真 hook」正确。
 * SSE 生命周期（受理信号、断流、中止、旧流闸门）只能在这一层验。
 */
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useAgentStream, AgentSendError, type StreamMessage } from "./agentStream"

const streamChatMock = vi.hoisted(() => vi.fn())

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>()
  return { ...actual, streamChat: streamChatMock }
})

type Api = ReturnType<typeof useAgentStream>
let result: { current: Api }

function renderHarness() {
  const rendered = renderHook(() => useAgentStream(), {
    wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
  })
  result = rendered.result
}

const api = () => result.current

function userMessages(): StreamMessage[] {
  return api().messages.filter((message) => message.type === "user")
}

afterEach(() => {
  cleanup()
  streamChatMock.mockReset()
})

describe("useAgentStream · 受理语义", () => {
  it("拿到 2xx 响应头后断流：失败带上 accepted=true", async () => {
    streamChatMock.mockImplementationOnce(
      async (_body: unknown, handlers: { onAccepted?: () => void }) => {
        handlers.onAccepted?.()
        throw new Error("连接中断")
      },
    )
    renderHarness()

    let error: unknown
    await act(async () => {
      try {
        await api().send("你好", "thread-1")
      } catch (e) {
        error = e
      }
    })

    expect(error).toBeInstanceOf(AgentSendError)
    expect((error as AgentSendError).accepted).toBe(true)
    // 流式态必须收干净，否则输入区一直锁着
    expect(api().isStreaming).toBe(false)
  })

  it("没拿到响应头就失败：accepted=false，不能当成没发出去", async () => {
    streamChatMock.mockRejectedValueOnce(new Error("network down"))
    renderHarness()

    let error: unknown
    await act(async () => {
      try {
        await api().send("你好", "thread-1")
      } catch (e) {
        error = e
      }
    })

    expect(error).toBeInstanceOf(AgentSendError)
    expect((error as AgentSendError).accepted).toBe(false)
    expect(api().isStreaming).toBe(false)
  })
})

describe("useAgentStream · 生命周期", () => {
  it("abort 之后不再接收在途事件，且 send 正常收尾", async () => {
    let emit: ((dto: unknown) => void) | undefined
    streamChatMock.mockImplementationOnce(
      async (_body: unknown, handlers: { onEvent: (dto: unknown) => void }) => {
        emit = handlers.onEvent
        // 模拟一个永不结束的流：由 abort 打断
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (!api().isStreaming) {
              clearInterval(timer)
              resolve()
            }
          }, 5)
        })
      },
    )
    renderHarness()

    let pending: Promise<void> | undefined
    await act(async () => {
      pending = api().send("你好", "thread-1")
      await Promise.resolve()
    })
    expect(api().isStreaming).toBe(true)

    await act(async () => {
      api().abort()
      await Promise.resolve()
    })
    expect(api().isStreaming).toBe(false)

    const before = api().messages.length
    act(() => {
      emit?.({ id: "late", messageType: "assistant", content: "迟到的一片" })
    })
    // 闸门后的事件不算数：中止之后界面不能再长出内容
    expect(api().messages.length).toBe(before)

    await act(async () => {
      await pending
    })
  })

  it("abort 之后仍在生成期间的 loading 光标被清掉", async () => {
    streamChatMock.mockImplementationOnce(async () => {
      await new Promise(() => {})
    })
    renderHarness()

    await act(async () => {
      void api().send("你好", "thread-1").catch(() => {})
      await Promise.resolve()
    })
    act(() => {
      api().pushUser({ id: "u1", type: "user", content: "你好" })
    })
    await act(async () => {
      api().abort()
    })

    expect(api().messages.some((message) => message.isLoading)).toBe(false)
    expect(api().isStreaming).toBe(false)
  })

  it("reset 清空消息与资源，并中断在途流", async () => {
    streamChatMock.mockImplementationOnce(async () => {
      await new Promise(() => {})
    })
    renderHarness()

    await act(async () => {
      void api().send("你好", "thread-1").catch(() => {})
      await Promise.resolve()
    })
    expect(api().isStreaming).toBe(true)

    await act(async () => {
      api().reset()
    })

    expect(api().messages).toHaveLength(0)
    expect(api().resources.images).toHaveLength(0)
    expect(api().isStreaming).toBe(false)
  })

  it("StrictMode 双挂载下推送的消息不会被清掉", async () => {
    renderHarness()
    act(() => {
      api().pushUser({ id: "u1", type: "user", content: "严格模式" })
    })
    expect(userMessages()).toHaveLength(1)
    expect(userMessages()[0].content).toBe("严格模式")
  })
})

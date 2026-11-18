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
import type { AgentStreamDTO } from "./api"

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

/** 造一个可手动推进的流：返回 handlers 与一个「结束」动作。 */
function fakeStream() {
  let end: () => void = () => {}
  let handlers: {
    onEvent(dto: AgentStreamDTO): void
    onDone(): void
    onError(err: unknown): void
  } | null = null
  let signal: AbortSignal | null = null

  streamChatMock.mockImplementation(
    async (_body: unknown, h: typeof handlers, sig: AbortSignal) => {
      handlers = h
      signal = sig
      // 挂起，直到 abort 或测试主动结束
      await new Promise<void>((resolve) => {
        end = resolve
        sig.addEventListener("abort", () => resolve(), { once: true })
      })
    },
  )

  return {
    emit(dto: AgentStreamDTO) {
      act(() => {
        handlers?.onEvent(dto)
      })
    },
    finish() {
      act(() => {
        handlers?.onDone()
        end()
      })
    },
    get signal() {
      return signal
    },
  }
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

  it("响应头一到就回调 onAccepted，且只回调一次", async () => {
    streamChatMock.mockImplementationOnce(
      async (_body: unknown, handlers: { onAccepted?: () => void }) => {
        // 后端的受理信号可能重复送达，回调只能一次
        handlers.onAccepted?.()
        handlers.onAccepted?.()
      },
    )
    renderHarness()

    const onAccepted = vi.fn()
    let outcome: unknown
    await act(async () => {
      outcome = await api().send("你好", "thread-1", [], onAccepted)
    })

    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ accepted: true, aborted: false, abortedBy: null })
  })

  it("请求 → 确认 → done/finally 保持等待确认，不产生已取消卡", async () => {
    const stream = fakeStream()
    renderHarness()
    await act(async () => { void api().send("查一下", "thread-A") })
    stream.emit({ messageType: "tool-request", toolCalls: [{ name: "searchDocuments", arguments: "{}", id: "a" }] })
    stream.emit({ messageType: "tool-confirm", toolCallId: "a", content: "等待审批" })
    await act(async () => { stream.finish() })
    expect(api().isStreaming).toBe(false)
    expect(api().messages.find((m) => m.type === "tool-request")?.toolStatus).toBe("awaiting-confirm")
    expect(api().messages.some((m) => m.toolStatus === "cancelled")).toBe(false)
  })
  it("响应头到达前被「停止」：返回 accepted=false / aborted=true，且不抛错", async () => {
    // fetch-event-source 在 abort 时是 resolve 而不是 reject——`await send()`
    // 会正常返回。调用方若把「没抛异常」当成功，就会把一次根本没拿到响应头的
    // 请求标成已受理。
    streamChatMock.mockImplementationOnce(
      async (_body: unknown, _handlers: unknown, signal: AbortSignal) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener("abort", () => resolve())
        })
      },
    )
    renderHarness()

    let outcome: unknown
    await act(async () => {
      const pending = api().send("你好", "thread-1")
      await Promise.resolve()
      api().abort()
      outcome = await pending
    })

    expect(outcome).toEqual({ accepted: false, aborted: true, abortedBy: "user" })
    expect(api().isStreaming).toBe(false)
  })
})

describe("useAgentStream · 生命周期", () => {
  it("abort 之后不再接收在途事件，且 send 正常收尾", async () => {
    let emit: ((dto: unknown) => void) | undefined
    let signal: AbortSignal | undefined
    streamChatMock.mockImplementationOnce(
      async (_body: unknown, handlers: { onEvent: (dto: unknown) => void }, s: AbortSignal) => {
        emit = handlers.onEvent
        signal = s
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

    let pending: Promise<unknown> | undefined
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
    // 「停止」必须真的把中止信号送到在途请求上，否则服务端还在生成
    expect(signal?.aborted).toBe(true)

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

  it("旧流晚到的收尾不清掉新流的停止句柄", async () => {
    // 旧流在新流已经开始之后才真正结束：它的 finally 若按「当前句柄」一把清，
    // 会把新流的 controller 一起扔掉——此后「停止」发出去了却中止不了任何请求。
    const signals: AbortSignal[] = []
    let finishFirst!: () => void
    streamChatMock
      .mockImplementationOnce(async (...args: unknown[]) => {
        const signal = args[2] as AbortSignal
        signals.push(signal)
        await new Promise<void>((resolve) => {
          finishFirst = resolve
        })
      })
      .mockImplementationOnce(async (...args: unknown[]) => {
        const signal = args[2] as AbortSignal
        signals.push(signal)
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener("abort", () => resolve())
        })
      })
    renderHarness()

    let first: Promise<unknown> | undefined
    await act(async () => {
      first = api().send("第一条", "thread-1")
      await Promise.resolve()
    })
    await act(async () => {
      api().abort()
      await Promise.resolve()
    })
    expect(signals[0]?.aborted).toBe(true)

    let second: Promise<unknown> | undefined
    await act(async () => {
      second = api().send("第二条", "thread-1")
      await Promise.resolve()
    })

    // 旧流现在才收尾
    await act(async () => {
      finishFirst()
      await first
    })

    // 新流的句柄还必须活着：这一次「停止」要能打到它身上
    await act(async () => {
      api().abort()
      await Promise.resolve()
    })
    expect(signals[1]?.aborted).toBe(true)

    await act(async () => {
      await second
    })
  })

  it("切会话后旧流的事件不再写进消息表", async () => {
    const stream = fakeStream()
    renderHarness()

    await act(async () => {
      void api().send("你好", "thread-A")
    })
    stream.emit({ messageType: "assistant", content: "旧流的内容" })
    expect(api().messages.length).toBeGreaterThan(0)

    act(() => {
      api().reset()
    })
    expect(api().messages).toHaveLength(0)

    // 旧流在 reset 之后才送来的事件——不能落进新会话的消息表。
    stream.emit({ messageType: "assistant", content: "迟到的旧流内容" })
    expect(api().messages).toHaveLength(0)
  })

  it("工具调用后前一条 assistant 不再是流式态（不永久闪烁）", async () => {
    const stream = fakeStream()
    renderHarness()

    await act(async () => {
      void api().send("查一下", "thread-A")
    })
    stream.emit({ messageType: "assistant", content: "我先查一下知识库" })
    stream.emit({
      messageType: "tool-request",
      content: "",
      toolCalls: [{ name: "searchDocuments", arguments: "{}" }],
    })

    expect(api().messages.find((m) => m.type === "assistant")?.isLoading).toBe(false)
  })
})

describe("useAgentStream · 会话资源", () => {
  it("流里回放的资源进入资源栏，切换会话后清空", async () => {
    streamChatMock.mockImplementationOnce(
      async (_body: unknown, handlers: { onEvent: (dto: unknown) => void; onDone: () => void }) => {
        handlers.onEvent({
          messageType: "tool-result",
          content: "检索到 1 段文档",
          toolName: "searchDocuments",
          toolCallId: "call_1",
          status: "success",
          resources: [
            {
              id: "doc:42",
              kind: "document",
              title: "干眼症诊疗共识",
              source: "knowledge-base",
              documentId: "42",
              score: 0.81,
            },
          ],
        })
        handlers.onDone()
      },
    )
    renderHarness()

    await act(async () => {
      await api().send("干眼怎么治", "thread-1")
    })

    expect(api().resources.documents).toHaveLength(1)
    expect(api().resources.documents[0].documentId).toBe("42")

    await act(async () => {
      api().reset()
    })
    expect(api().resources.documents).toHaveLength(0)
  })

  it("历史加载后资源从消息里重建（刷新 / 切会话不丢）", async () => {
    renderHarness()
    const history: StreamMessage[] = [
      {
        id: "h1",
        type: "user",
        content: "看看这张图",
        images: ["https://cos.example.com/f.jpg"],
      },
      {
        id: "h2",
        type: "tool-response",
        content: "检索到 1 段文档",
        toolStatus: "success",
        resources: [
          {
            id: "doc:7",
            kind: "document",
            title: "眼底影像判读要点",
            source: "knowledge-base",
            documentId: "7",
          },
        ],
      },
    ]

    await act(async () => {
      api().setMessages(history)
    })

    expect(api().resources.images).toHaveLength(1)
    expect(api().resources.documents).toHaveLength(1)
  })
})

/**
 * Agent SSE 流核心：事件 reducer（纯函数，可单测）+ React hook。
 *
 * 事件语义对齐后端 DiagnosisAgent：assistant 逐片累加、reasoning 独立累加、
 * tool-request/tool-response/tool-confirm 都截断累加回合。tool-confirm 是
 * 信息性终点卡——后端图中断后流即结束，没有确认回传端点。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { streamChat, type AgentStreamDTO, type HistoryMessageVO } from "./api"
import { extractResources, type AgentResources } from "./agentResources"

export type StreamMsgType =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool-request"
  | "tool-response"
  | "confirm"

export type ToolCallArg = {
  name: string
  args: Record<string, unknown>
}

export type StreamMessage = {
  id: string
  type: StreamMsgType
  content: string
  /** 仅 assistant 流式进行中为 true。 */
  isLoading?: boolean
  toolName?: string
  toolCalls?: ToolCallArg[]
  time?: string
  images?: string[]
}

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

/** assistant 是否可继续累加：最后一条就是它且仍在流式中。 */
function lastAppendableAssistant(msgs: StreamMessage[]): StreamMessage | undefined {
  const last = msgs[msgs.length - 1]
  return last && last.type === "assistant" && last.isLoading ? last : undefined
}

/** reasoning 可续写条件：最后一条是 reasoning，且其后没有 assistant/tool 类消息截断回合。 */
function lastAppendableReasoning(msgs: StreamMessage[]): StreamMessage | undefined {
  const last = msgs[msgs.length - 1]
  return last && last.type === "reasoning" && !last.isLoading ? last : undefined
}

/** SSE 事件 → 消息数组的纯 reducer。工具/确认类事件截断此前的累加回合。 */
export function applyStreamEvent(
  msgs: StreamMessage[],
  dto: AgentStreamDTO,
): StreamMessage[] {
  const type = (dto.messageType ?? "").toLowerCase()
  const content = dto.content ?? ""

  switch (type) {
    case "assistant": {
      const target = lastAppendableAssistant(msgs)
      if (target) {
        return [
          ...msgs.slice(0, -1),
          { ...target, content: target.content + content },
        ]
      }
      return [
        ...msgs,
        { id: newId(), type: "assistant", content, isLoading: true },
      ]
    }

    case "reasoning": {
      const target = lastAppendableReasoning(msgs)
      if (target) {
        return [
          ...msgs.slice(0, -1),
          { ...target, content: target.content + content },
        ]
      }
      return [...msgs, { id: newId(), type: "reasoning", content }]
    }

    case "tool-request": {
      const out = [...msgs]
      for (const tc of dto.toolCalls ?? []) {
        const name = tc.name || "工具"
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(tc.arguments || "{}")
        } catch {
          parsedArgs = { _raw: tc.arguments }
        }
        out.push({
          id: newId(),
          type: "tool-request",
          content: "",
          toolName: name,
          toolCalls: [{ name, args: parsedArgs }],
        })
      }
      return out
    }

    case "tool-response":
      return [
        ...msgs,
        {
          id: newId(),
          type: "tool-response",
          content,
          toolName: dto.toolName,
        },
      ]

    // 兼容后端 MessageType.TOOL_CONFIRM（序列化为 tool-confirm）
    // 与历史 mcp-confirm 事件名。两者都是图中断的终点卡。
    case "tool-confirm":
    case "mcp-confirm":
      return [...msgs, { id: newId(), type: "confirm", content }]

    default:
      return msgs
  }
}

/** "2026-11-08 10:00:00" 无时区；只取时分展示。 */
function formatTime(createdTime: string): string {
  const d = new Date(createdTime.replace(" ", "T"))
  if (Number.isNaN(d.getTime())) return ""
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** 历史消息 role/subType → 流消息类型。 */
export function mapHistoryMessage(m: HistoryMessageVO): StreamMessage {
  let type: StreamMsgType
  if (m.role === "USER") {
    type = "user"
  } else {
    switch (m.subType) {
      case "reasoning":
        type = "reasoning"
        break
      case "tool-call":
        type = "tool-request"
        break
      case "tool-result":
        type = "tool-response"
        break
      case "mcp-confirm":
      case "tool-confirm":
        type = "confirm"
        break
      default:
        type = "assistant"
    }
  }
  return {
    id: newId(),
    type,
    content: m.content,
    toolName:
      m.subType === "tool-call" || m.subType === "tool-result"
        ? m.content.split(":")[0] || "工具"
        : undefined,
    time: m.createdTime ? formatTime(m.createdTime) : "",
  }
}

export function useAgentStream() {
  const [messages, setMessages] = useState<StreamMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [resources, setResources] = useState<AgentResources>({
    images: [],
    links: [],
  })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      // StrictMode 双挂载安全：abort 未激活的 controller 是 no-op
      abortRef.current?.abort()
      abortRef.current = null
    },
    [],
  )

  const send = useCallback(
    async (message: string, threadId: string, urls: string[] = []) => {
      setIsStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller

      const clearLoading = () => {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (!last || !last.isLoading) return prev
          return [...prev.slice(0, -1), { ...last, isLoading: false }]
        })
      }

      try {
        await streamChat(
          {
            message,
            threadId,
            imageUrls: urls.length > 0 ? urls : undefined,
          },
          {
            onEvent(dto) {
              setMessages((prev) => applyStreamEvent(prev, dto))
              if ((dto.messageType ?? "").toLowerCase() === "tool-response") {
                setResources((prev) => extractResources(dto.content ?? "", prev))
              }
            },
            onDone() {
              clearLoading()
            },
            onError(err) {
              clearLoading()
              throw err
            },
          },
          controller.signal,
        )
      } catch (e) {
        clearLoading()
        throw e
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const pushUser = useCallback((msg: StreamMessage) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  /** 历史加载用：整表替换消息。 */
  const setMessagesAll = useCallback((msgs: StreamMessage[]) => {
    setMessages(msgs)
  }, [])

  const reset = useCallback(() => {
    setMessages([])
    setResources({ images: [], links: [] })
  }, [])

  return {
    messages,
    isStreaming,
    resources,
    send,
    abort,
    pushUser,
    setMessages: setMessagesAll,
    reset,
  }
}

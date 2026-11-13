/**
 * Agent SSE 流核心：事件 reducer（纯函数，可单测）+ React hook。
 *
 * 事件语义对齐后端 DiagnosisAgent：assistant 逐片累加、reasoning 独立累加、
 * tool-request/tool-response/tool-confirm 都截断累加回合。tool-confirm 是
 * 信息性终点卡——后端图中断后流即结束，没有确认回传端点。
 */
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react"
import { streamChat, type AgentStreamDTO, type HistoryMessageVO } from "./api"
import { extractResources, type AgentResources } from "./agentResources"

export type StreamMsgType =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool-request"
  | "tool-response"
  | "confirm"

/** 工具步骤状态：值由后端 ToolStepContract 固定，前端不做自由文本展示。 */
export type ToolStepStatus =
  | "awaiting-confirm"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"

export type ToolCallArg = {
  name: string
  args: Record<string, unknown>
  /** 后端工具调用 id；状态事件靠它归属到具体卡片，避免并发串台。 */
  id?: string
  /** 固定白名单标签，缺失时回退到工具名。 */
  stepLabel?: string
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
  /* ── 普通聊天工具步骤契约（可选，兼容历史消息与旧后端） ── */
  toolCallId?: string
  toolStatus?: ToolStepStatus
  stepLabel?: string
  finishReason?: string
  errorCategory?: string
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

/** 清掉所有流式中的 assistant（回合结束或被截断时调用）。 */
export function clearAllLoading(msgs: StreamMessage[]): StreamMessage[] {
  if (!msgs.some((m) => m.isLoading)) return msgs
  return msgs.map((m) => (m.isLoading ? { ...m, isLoading: false } : m))
}

/**
 * 工具/确认类事件会截断此前的累加回合——此时把还在流式中的 assistant
 * 收尾（isLoading=false），否则它会永远带着闪烁光标、且按纯文本渲染。
 */
function truncate(msgs: StreamMessage[]): StreamMessage[] {
  return clearAllLoading(msgs)
}

/** 白名单状态值；后端新增/异常值一律当作未带上状态，绝不自行推断成功。 */
const TOOL_STATUSES: ToolStepStatus[] = [
  "awaiting-confirm", "running", "succeeded", "failed", "cancelled",
]
function parseToolStatus(raw: unknown): ToolStepStatus | undefined {
  return TOOL_STATUSES.includes(raw as ToolStepStatus) ? (raw as ToolStepStatus) : undefined
}

/**
 * 状态事件按 toolCallId 归属到对应卡片；找不到目标时返回 null，调用方
 * 自行决定是否补一张匿名卡。绝不把状态套到"最后一张"卡上——并发工具会串台。
 */
function applyToolStatus(
  msgs: StreamMessage[],
  dto: AgentStreamDTO,
): StreamMessage[] | null {
  const status = parseToolStatus(dto.toolStatus)
  const callId = dto.toolCallId
  if (!status || !callId) return null
  let found = false
  const out = msgs.map((m) => {
    if (m.type !== "tool-request" || m.toolCallId !== callId) return m
    found = true
    return {
      ...m,
      toolStatus: status,
      stepLabel: dto.stepLabel ?? m.stepLabel,
      finishReason: dto.finishReason,
      errorCategory: dto.errorCategory,
    }
  })
  return found ? out : null
}

/**
 * 流终止时把仍未收到真实结果的卡统一标成 cancelled；已有成功/失败/取消
 * 终态的卡不动。错误、断流和取消都走这里，绝不产生虚假成功。
 */
export function markPendingToolsCancelled(msgs: StreamMessage[]): StreamMessage[] {
  let changed = false
  const out = msgs.map((m) => {
    if (m.type !== "tool-request" || !m.toolCallId) return m
    if (m.toolStatus === "succeeded" || m.toolStatus === "failed" || m.toolStatus === "cancelled") return m
    changed = true
    return { ...m, toolStatus: "cancelled" as ToolStepStatus, finishReason: "INTERRUPTED" }
  })
  return changed ? out : msgs
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
      const out = truncate(msgs)
      for (const tc of dto.toolCalls ?? []) {
        const name = tc.name || "工具"
        let parsedArgs: Record<string, unknown>
        try {
          parsedArgs = JSON.parse(tc.arguments || "{}")
        } catch {
          parsedArgs = { _raw: tc.arguments }
        }
        const callId = tc.id ?? undefined
        const status = parseToolStatus(dto.toolStatus) ?? (callId ? "running" : undefined)
        out.push({
          id: newId(),
          type: "tool-request",
          content: "",
          toolName: name,
          toolCallId: callId,
          toolStatus: status,
          stepLabel: tc.stepLabel ?? dto.stepLabel ?? name,
          toolCalls: [{ name, args: parsedArgs, id: callId, stepLabel: tc.stepLabel ?? dto.stepLabel }],
        })
      }
      return out
    }

    // 后端 MessageType.TOOL_RESULT 序列化为 "tool-result"：带 toolCallId +
    // toolStatus 时是状态增量，按 id 归属到已有卡片；没有状态字段的存量
    // tool-result 仍走旧的独立结果卡，保持历史兼容。
    case "tool-result": {
      const status = parseToolStatus(dto.toolStatus)
      const statusApplied = applyToolStatus(msgs, dto)
      if (statusApplied) return statusApplied
      if (status && dto.toolCallId) {
        // 状态事件先于 TOOL_REQUEST 到达：补一张最小匿名卡，不推断成功。
        return [
          ...truncate(msgs),
          {
            id: newId(),
            type: "tool-request",
            content: "",
            toolName: dto.toolName,
            toolCallId: dto.toolCallId,
            toolStatus: status,
            stepLabel: dto.stepLabel,
            finishReason: dto.finishReason,
            errorCategory: dto.errorCategory,
          },
        ]
      }
      // 带 toolCallId 却没有合法状态：这是状态帧但内容不可信，fail-closed 丢弃，
      // 绝不降级成一张空的旧式结果卡，也不推断成功。
      if (dto.toolCallId) return msgs
      return [
        ...truncate(msgs),
        {
          id: newId(),
          type: "tool-response",
          content,
          toolName: dto.toolName,
        },
      ]
    }

    case "tool-response":
      return [
        ...truncate(msgs),
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
      return [
        ...truncate(msgs),
        {
          id: newId(),
          type: "confirm",
          content,
          toolCallId: dto.toolCallId,
          toolStatus: parseToolStatus(dto.toolStatus) ?? "awaiting-confirm",
          stepLabel: dto.stepLabel,
        },
      ]

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

  // 历史里的工具调用落库格式是「工具名: 参数 JSON」（DiagnosisAgent.java:168-173），
  // 不解析的话工具步骤只剩一行空白的 TOOL 标签。
  if (type === "tool-request") {
    const parsed = parseToolCallText(m.content)
    return {
      id: newId(),
      type,
      content: "",
      toolName: parsed?.name,
      toolCalls: parsed ? [parsed] : undefined,
      time: m.createdTime ? formatTime(m.createdTime) : "",
    }
  }

  return {
    id: newId(),
    type,
    content: m.content,
    // tool-result 在后端没有落库（saveToolResultMessage 无调用方），
    // 保留分支只为兼容存量数据；内容是工具输出，从中切名字没有意义。
    toolName: undefined,
    time: m.createdTime ? formatTime(m.createdTime) : "",
  }
}

/** 「工具名: 参数 JSON」→ { name, args }；解析不出时返回 null。 */
function parseToolCallText(content: string): ToolCallArg | null {
  const sep = content.indexOf(":")
  if (sep <= 0) return null
  const name = content.slice(0, sep).trim()
  const raw = content.slice(sep + 1).trim()
  if (!name) return null
  try {
    return { name, args: JSON.parse(raw || "{}") as Record<string, unknown> }
  } catch {
    return { name, args: { _raw: raw } }
  }
}

export function useAgentStream() {
  const [messages, setMessages] = useState<StreamMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [resources, setResources] = useState<AgentResources>({
    images: [],
    links: [],
  })
  // 句柄带令牌：旧流收尾时新流可能已经建立，不能按「当前句柄」一把清。
  const abortRef = useRef<{ token: number; controller: AbortController } | null>(null)
  const streamSeq = useRef(0)
  // 事件闸门：中止/切会话后，在途流送来的事件一律不算数。
  // 与 streamSeq 分开：闸门只拦事件，不拦收尾清理（中止后仍要收掉光标）。
  const eventSeq = useRef(0)

  useEffect(
    () => () => {
      // StrictMode 双挂载安全：abort 未激活的 controller 是 no-op
      abortRef.current?.controller.abort()
      abortRef.current = null
    },
    [],
  )

  const send = useCallback(
    async (message: string, threadId: string, urls: string[] = []) => {
      setIsStreaming(true)
      const token = ++streamSeq.current
      const eventToken = eventSeq.current
      const controller = new AbortController()
      abortRef.current = { token, controller }

      // 只操作自己这一流：晚到的旧流不得清掉新流的流式态与光标。
      const isCurrent = () => streamSeq.current === token
      const clearLoading = () => {
        if (!isCurrent()) return
        setMessages((prev) => clearAllLoading(prev))
      }
      // 正常结束也兜底：后端若未下发终态，前端不会把「没结果」显示成成功。
      const settleTools = () => {
        if (!isCurrent()) return
        setMessages((prev) => markPendingToolsCancelled(prev))
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
              if (eventToken !== eventSeq.current) return
              setMessages((prev) => applyStreamEvent(prev, dto))
              if ((dto.messageType ?? "").toLowerCase() === "tool-response") {
                setResources((prev) => extractResources(dto.content ?? "", prev))
              }
            },
            onDone() {
              clearLoading()
              settleTools()
            },
            onError(err) {
              clearLoading()
              settleTools()
              throw err
            },
          },
          controller.signal,
        )
      } catch (e) {
        clearLoading()
        settleTools()
        // 旧流的错误不得冒泡成新流的失败
        if (isCurrent()) throw e
      } finally {
        // abort 时 fetch-event-source 直接 resolve，不触发 onDone/onError，
        // 所以收尾必须放在 finally——否则被「停止」打断的回复永远带着光标。
        if (isCurrent()) {
          clearLoading()
          settleTools()
          setIsStreaming(false)
          abortRef.current = null
        }
      }
    },
    [],
  )

  const abort = useCallback(() => {
    // 闸门递增：被中止的流随后送来的事件不算数（收尾清理照旧）。
    eventSeq.current += 1
    abortRef.current?.controller.abort()
    abortRef.current = null
    setIsStreaming(false)
    // 用户主动停止：没有真实结果的卡一律取消，绝不显示成功。
    setMessages((prev) => markPendingToolsCancelled(prev))
  }, [])

  const pushUser = useCallback((msg: StreamMessage) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  /** 历史加载/撤回用：整表替换消息，也接受更新函数。 */
  const setMessagesAll = useCallback((msgs: SetStateAction<StreamMessage[]>) => {
    setMessages(msgs)
  }, [])

  const reset = useCallback(() => {
    // 切会话/新建会话必须先中断在途 SSE——否则旧回合的 token 会继续写进新会话。
    // 闸门一并递增：旧流在中断之后才送来的事件，一律不算数。
    eventSeq.current += 1
    abortRef.current?.controller.abort()
    abortRef.current = null
    setIsStreaming(false)
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

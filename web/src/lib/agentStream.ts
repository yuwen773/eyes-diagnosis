/**
 * Agent SSE 流核心：事件 reducer（纯函数，可单测）+ React hook。
 *
 * 事件语义对齐后端 DiagnosisAgent：assistant 逐片累加、reasoning 独立累加、
 * tool-request/tool-response/tool-confirm 都截断累加回合。tool-confirm 是
 * 信息性终点卡——后端图中断后流即结束，没有确认回传端点。
 */
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react"
import { ApiError, streamChat, type AgentStreamDTO, type HistoryMessageVO } from "./api"
import { extractResources, type AgentResources } from "./agentResources"
import { newId } from "./id"
import { formatClock, parseApiDate, parseApiTime } from "./time"

export type StreamMsgType =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool-request"
  | "tool-response"
  | "confirm"

export type ToolCallArg = {
  /** 稳定关联键；历史旧数据可能没有。 */
  id?: string
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
  toolCallId?: string
  /**
   * 工具结果状态（仅 tool-response）：success / error / timeout /
   * cancelled / completed / unknown。缺省表示历史旧数据没有回执。
   */
  toolStatus?: string
  toolCalls?: ToolCallArg[]
  time?: string
  images?: string[]
  /**
   * 仅用户轮次：这条提问在服务端是什么状态。
   *
   * <p>缺省（历史消息）表示「服务端已有记录」。实时发送的乐观气泡依次经过
   * `sending → accepted | unconfirmed → failed`。`unconfirmed` 是诚实的中间态：
   * 请求发出去了但没拿到 2xx 响应头，服务端到底有没有落库**不知道**。
   */
  delivery?: "sending" | "accepted" | "unconfirmed" | "failed"
}

/** 服务端明确拒绝这次请求的错误码（未登录 / 无权限）。 */
const REJECTED_CODES = new Set([40100, 40101, 40300])

/**
 * 发送失败。两个标记回答两个不同的问题：
 *
 * <ul>
 *   <li>`accepted`：拿到 2xx 流响应头了吗？拿到 = 服务端受理了**这次请求**
 *       （用户消息已入队）；<b>不代表已经落库</b>——落库是会话队列里的异步任务。
 *       没拿到 = 不知道服务端收没收到。</li>
 *   <li>`rejected`：服务端是否**明确拒绝**（40100/40101/40300）？只有这一种
 *       情况能断言「这条消息没有进入服务端记录」。网络失败、超时、5xx 都不算。</li>
 * </ul>
 */
export class AgentSendError extends Error {
  readonly accepted: boolean
  readonly rejected: boolean
  readonly cause?: unknown

  constructor(accepted: boolean, message: string, cause?: unknown) {
    super(message)
    this.name = "AgentSendError"
    this.accepted = accepted
    this.rejected = !accepted && cause instanceof ApiError && REJECTED_CODES.has(cause.code)
    this.cause = cause
  }
}

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

/** SSE 事件 → 消息数组的纯 reducer。工具/确认类事件截断此前的累加回合。 */
export function applyStreamEvent(
  msgs: StreamMessage[],
  dto: AgentStreamDTO,
): StreamMessage[] {
  const type = (dto.messageType ?? "").toLowerCase()
  const content = dto.content ?? ""
  const time = eventClock(dto.timestamp)

  switch (type) {
    case "assistant": {
      const target = lastAppendableAssistant(msgs)
      if (target) {
        return [
          ...msgs.slice(0, -1),
          {
            ...target,
            content: target.content + content,
            // 首片时间就是这一轮的落点；后续分片不再改写它。
            time: target.time ?? time,
          },
        ]
      }
      return [
        ...msgs,
        { id: newId(), type: "assistant", content, isLoading: true, time },
      ]
    }

    case "reasoning": {
      const target = lastAppendableReasoning(msgs)
      if (target) {
        return [
          ...msgs.slice(0, -1),
          {
            ...target,
            content: target.content + content,
            time: target.time ?? time,
          },
        ]
      }
      return [...msgs, { id: newId(), type: "reasoning", content, time }]
    }

    case "tool-request": {
      // 必须构造新数组：truncate 在没有流式 assistant 时原样返回同一引用，
      // 就地 push 会改写上一份 state 并返回同引用 —— React 按 Object.is 判定
      // 「没变」而跳过渲染（工具卡不出现），StrictMode 双调用还会 push 两次。
      const base = truncate(msgs)
      const added = (dto.toolCalls ?? []).map((tc) => {
        const name = tc.name || "工具"
        let parsedArgs: Record<string, unknown>
        try {
          parsedArgs = JSON.parse(tc.arguments || "{}")
        } catch {
          parsedArgs = { _raw: tc.arguments }
        }
        return {
          id: newId(),
          type: "tool-request" as const,
          content: "",
          toolName: name,
          toolCallId: tc.id,
          toolCalls: [{ id: tc.id, name, args: parsedArgs }],
          time,
        }
      })
      return added.length === 0 ? base : [...base, ...added]
    }

    // 后端新契约是 tool-result；tool-response 是前端历史内部名与旧别名。
    case "tool-result":
    case "tool-response":
      return [
        ...truncate(msgs),
        {
          id: newId(),
          type: "tool-response",
          content,
          toolName: dto.toolName,
          toolCallId: dto.toolCallId,
          toolStatus: dto.status,
          time,
        },
      ]

    // 兼容后端 MessageType.TOOL_CONFIRM（序列化为 tool-confirm）
    // 与历史 mcp-confirm 事件名。两者都是图中断的终点卡。
    case "tool-confirm":
    case "mcp-confirm":
      return [...truncate(msgs), { id: newId(), type: "confirm", content, time }]

    default:
      return msgs
  }
}

/** SSE 时间戳 → 本地 HH:mm；缺失或不可解析时留空，不猜。 */
function eventClock(timestamp?: string): string | undefined {
  const date = parseApiDate(timestamp)
  return date ? formatClock(date) : undefined
}

/** 历史时间点 → 本地 HH:mm；解析不出留空。 */
function formatHistoryTime(createdTime?: string): string {
  const date = parseApiDate(createdTime)
  return date ? formatClock(date) : ""
}

/**
 * 历史消息时间 → epoch 毫秒。
 *
 * <p>历史核对要用它判断「这条是不是刚发的那条」：字面相同但时间早得多的
 * 消息，只可能是用户以前问过一模一样的问题。新 API 是带偏移的 ISO；旧数据
 * 是无偏移的 UTC 墙钟，由 {@link parseApiDate} 统一处理。解析不出返回
 * `null`，调用方据此放弃判断而不是瞎猜。
 */
export function parseServerTime(createdTime: string | undefined): number | null {
  return parseApiTime(createdTime)
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

  const time = formatHistoryTime(m.createdTime)

  if (type === "tool-request") {
    // 新落库格式是带 toolCallId 的 JSON；旧格式是「工具名: 参数 JSON」。
    const parsed = parsePersistedToolCall(m.content)
    return {
      id: newId(),
      type,
      content: "",
      toolName: parsed?.name,
      toolCallId: parsed?.id,
      toolCalls: parsed ? [parsed] : undefined,
      time,
    }
  }

  if (type === "tool-response") {
    // 新落库格式带 toolCallId / status / output；旧行是工具输出原文。
    const parsed = parsePersistedToolResult(m.content)
    return {
      id: newId(),
      type,
      content: parsed.output,
      toolName: parsed.name,
      toolCallId: parsed.toolCallId,
      // 旧行没有状态，但「有这一行」本身就说明工具返回过结果：
      // 标 completed（已返回），不冒充 success，也不说未确认。
      toolStatus: parsed.status ?? "completed",
      time,
    }
  }

  return {
    id: newId(),
    type,
    content: m.content,
    time,
  }
}

type ParsedToolCall = ToolCallArg

/** 新格式 `{toolCallId,name,arguments}`；解析不出回退旧格式「name: args」。 */
function parsePersistedToolCall(content: string): ParsedToolCall | null {
  const trimmed = content.trim()
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.name === "string") {
        let args: Record<string, unknown>
        if (typeof parsed.arguments === "string") {
          try {
            args = JSON.parse(parsed.arguments || "{}") as Record<string, unknown>
          } catch {
            args = { _raw: parsed.arguments }
          }
        } else if (parsed.arguments && typeof parsed.arguments === "object") {
          args = parsed.arguments as Record<string, unknown>
        } else {
          args = {}
        }
        return {
          id: typeof parsed.toolCallId === "string" ? parsed.toolCallId : undefined,
          name: parsed.name,
          args,
        }
      }
    } catch {
      // 落到旧格式解析
    }
  }
  return parseToolCallText(content)
}

type ParsedToolResult = {
  toolCallId?: string
  name?: string
  status?: string
  output: string
}

/** 新格式 `{toolCallId,name,status,output}`；旧行把整段内容当输出。 */
function parsePersistedToolResult(content: string): ParsedToolResult {
  const trimmed = content.trim()
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if ("output" in parsed || "status" in parsed || "toolCallId" in parsed) {
        return {
          toolCallId: typeof parsed.toolCallId === "string" ? parsed.toolCallId : undefined,
          name: typeof parsed.name === "string" ? parsed.name : undefined,
          status: typeof parsed.status === "string" ? parsed.status : undefined,
          output: typeof parsed.output === "string" ? parsed.output : "",
        }
      }
    } catch {
      // 旧行
    }
  }
  return { output: content }
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

/**
 * 一次 `send()` 的结果。**不看有没有助手内容**——「助手一句话没说」既可能是
 * 服务端没收到，也可能是收到了但生成失败，两者在流里长得一模一样。
 *
 * <ul>
 *   <li>`accepted`：拿到 2xx 响应头（用户消息**已入队**，落库是会话队列里的
 *       异步任务，所以不等于「已落库」）。</li>
 *   <li>`aborted`：被「停止」/切会话/换账号打断。这是用户按的，不是故障。</li>
 * </ul>
 *
 * <p>`aborted === true && accepted === false` 是最容易写错的一格：`fetch-event-source`
 * 在被 abort 时**resolve** 而不是 reject，`await send()` 会正常返回。调用方若
 * 默认「没抛异常 = 成功」，就会把一次根本没拿到响应头的请求标成已受理。
 */
export type SendOutcome = {
  accepted: boolean
  aborted: boolean
  /**
   * 谁中止的：`user` 是用户自己按了「停止」，`superseded` 是会话被切走 / 组件卸载。
   * 两者在界面上的正确反应**相反**：前者该把草稿留给用户重试，后者绝不该把上一个
   * 会话的原文灌回新会话的输入框（下一次回车就发错会话了）。
   */
  abortedBy: "user" | "superseded" | null
}

export function useAgentStream() {
  const [messages, setMessages] = useState<StreamMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [resources, setResources] = useState<AgentResources>({
    images: [],
    links: [],
  })
  // 句柄带令牌：旧流收尾时新流可能已经建立，不能按「当前句柄」一把清。
  // `cause` 由中止方填写，send() 据此回报 SendOutcome.abortedBy。
  const abortRef = useRef<{
    token: number
    controller: AbortController
    cause: "user" | "superseded" | null
  } | null>(null)
  const streamSeq = useRef(0)
  // 事件闸门：中止/切会话后，在途流送来的事件一律不算数。
  // 与 streamSeq 分开：闸门只拦事件，不拦收尾清理（中止后仍要收掉光标）。
  const eventSeq = useRef(0)

  useEffect(
    () => () => {
      // StrictMode 双挂载安全：abort 未激活的 controller 是 no-op
      if (abortRef.current) {
        abortRef.current.cause = "superseded"
        abortRef.current.controller.abort()
      }
      abortRef.current = null
    },
    [],
  )

  const send = useCallback(
    async (
      message: string,
      threadId: string,
      urls: string[] = [],
      /**
       * 响应头到达时立刻回调一次。用户气泡的「已受理」必须在这里翻，
       * 不能等整条流结束——流中途断掉时那一轮**确实已经受理**，
       * 等流结束再标会把它写成「未确认」。
       */
      onAccepted?: () => void,
    ): Promise<SendOutcome> => {
      setIsStreaming(true)
      const token = ++streamSeq.current
      const eventToken = eventSeq.current
      const controller = new AbortController()
      const handle = { token, controller, cause: null as "user" | "superseded" | null }
      abortRef.current = handle
      // 服务端是否已受理（拿到 2xx 响应头）。失败时这是判断能不能撤回
      // 乐观用户气泡的唯一依据——见 AgentSendError。注意它只说明「请求被受理」，
      // 不说明「已落库」。
      let accepted = false

      // 只操作自己这一流：晚到的旧流不得清掉新流的流式态与光标。
      const isCurrent = () => streamSeq.current === token
      const clearLoading = () => {
        if (!isCurrent()) return
        setMessages((prev) => clearAllLoading(prev))
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
            },
            onAccepted() {
              if (accepted) return
              accepted = true
              onAccepted?.()
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
        // 旧流的错误不得冒泡成新流的失败
        if (isCurrent()) {
          throw new AgentSendError(accepted, e instanceof Error ? e.message : String(e), e)
        }
      } finally {
        // abort 时 fetch-event-source 直接 resolve，不触发 onDone/onError，
        // 所以收尾必须放在 finally——否则被「停止」打断的回复永远带着光标。
        if (isCurrent()) {
          clearLoading()
          setIsStreaming(false)
          abortRef.current = null
        }
      }
      return {
        accepted,
        aborted: controller.signal.aborted,
        abortedBy: controller.signal.aborted ? (handle.cause ?? "superseded") : null,
      }
    },
    [],
  )

  const abort = useCallback(() => {
    // 闸门递增：被中止的流随后送来的事件不算数（收尾清理照旧）。
    eventSeq.current += 1
    if (abortRef.current) {
      // 用户主动按的「停止」：页面对这一格的处理是「草稿留给你重试」。
      abortRef.current.cause = "user"
      abortRef.current.controller.abort()
    }
    abortRef.current = null
    setIsStreaming(false)
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
    if (abortRef.current) {
      // 会话被切走：调用方不该为此回填草稿（那是上一个会话的问题）。
      abortRef.current.cause = "superseded"
      abortRef.current.controller.abort()
    }
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

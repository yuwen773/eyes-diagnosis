/**
 * 执行过程（Thought Line）的数据层。
 *
 * <p>**这里只把已经真实发生过的 SSE 事件整理成步骤，不生成任何一步。**
 * 输入只有 `reasoning` / `tool-request` / `tool-response` / `tool-confirm`
 * 四类真实事件；没有事件就没有步骤。工具调用与它的返回按 `toolCallId`
 * 配对，用户看到的是「做了什么、结果如何」，而不是两段互不相干的系统日志。
 *
 * <p>纯函数：输入消息数组，输出「消息 / 过程块」交替的线程结构。
 * 可单测，不碰 React。
 */

import type { StreamMessage } from "./agentStream"

/**
 * 步骤状态。
 *
 * <p>`pending` 是「流已结束、没有收到工具返回」，展示成「未确认」：
 * 既不是完成，也不是还在等——后端不会给已结束的回合补发回执。
 * `returned` 是「结果回来了，但没有拿到成败判定」（后端观察到的事件里没有
 * 这个 toolCallId 的记录，或后端给了我们还不认识的 status）——展示成「已返回」，
 * 不画实心对勾：把「框架返回了结果」说成「执行成功」是在替后端下结论。
 * `error` / `timeout` / `cancelled` 是有观察依据的失败，不是猜的。
 */
export type AgentStepState =
  | "done"
  | "returned"
  | "running"
  | "pending"
  | "paused"
  | "error"
  | "timeout"
  | "cancelled"

export type AgentStepKind = "reasoning" | "tool" | "confirm"

export type AgentStep = {
  id: string
  kind: AgentStepKind
  /** 步骤标题：工具名 / 「模型推理」/「工具执行已暂停」。 */
  label: string
  state: AgentStepState
  /** 工具的原始标识（模型实际调用的函数名）。 */
  toolName?: string
  /** 请求与结果共用的稳定关联键。 */
  toolCallId?: string
  /** 工具参数（键值对，已脱敏）。 */
  args?: { key: string; value: string }[]
  /** 工具返回原文（已脱敏）。 */
  output?: string
  /**
   * 是否真正收到过返回。空字符串结果也是「收到」——
   * 旧实现用 `!output` 判断，把空返回误判成「没有返回」。
   */
  received?: boolean
  /** 推理正文（仅 reasoning 步）。 */
  text?: string
  /** 暂停说明（仅 confirm 步）。 */
  note?: string
}

/**
 * 内置工具的中文说法。
 *
 * <p>模型调用的是函数名（`searchDocuments`），直接甩给用户看等于把内部
 * 标识当界面文案。这里只登记仓库自己的内置工具——MCP 工具名由用户自己配，
 * 无法预知，就原样显示。
 */
const TOOL_LABELS: Record<string, string> = {
  searchDocuments: "检索知识库文档",
  analyzeEyeImage: "分析眼底图像",
}

/** 工具名 → 展示用标签（未知工具原样返回，不猜）。 */
export function toolLabel(name: string | undefined): string {
  if (!name) return "工具"
  return TOOL_LABELS[name] ?? name
}

/** 线程里的一段：一条普通消息，或一整块执行过程。 */
export type ThreadItem =
  | { type: "message"; message: StreamMessage }
  | { type: "process"; id: string; steps: AgentStep[] }

/** 会进入执行过程的四种真实事件。 */
function isProcessMessage(msg: StreamMessage): boolean {
  return (
    msg.type === "reasoning" ||
    msg.type === "tool-request" ||
    msg.type === "tool-response" ||
    msg.type === "confirm"
  )
}

/**
 * 参数里可能出现的敏感键名。工具参数是模型生成的，不是用户写的，
 * 但仍可能带上凭据——展示前统一打码。
 *
 * <p>只认**键名**、不看值的长相：值像不像密码没有可靠判据，硬猜会把
 * 正常参数打掉。键名在任意深度都算——嵌套的 `config.apiKey` 与顶层的
 * `apiKey` 一样危险。
 */
const SENSITIVE_KEY =
  /(pass|pwd|secret|token|api[-_]?key|apikey|authorization|cookie|credential|private[-_]?key|access[-_]?key|client[-_]?secret|session[-_]?id)/i

/**
 * 带敏感词、但其实只是计数/上限的键名：`max_tokens: 4096` 打码之后
 * 反而让人以为参数丢了。这类键保持原值。
 */
const SAFE_KEY = /^(max[-_]?tokens?|token[-_]?(count|limit|budget)|maxTokens)$/i

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) && !SAFE_KEY.test(key)
}

/** 敏感值一律换成固定占位串，不保留长度信息。 */
export const REDACTED = "••••••"

/** 递归深度上限：参数是模型生成的，防一手自引用结构。 */
const MAX_DEPTH = 8

/**
 * 键值递归打码：嵌套对象、数组里的敏感键都换掉。
 *
 * <p>只打码键名命中的值，不改结构——读者仍看得出参数长什么样，
 * 但看不到凭据。
 */
function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "…"
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(inner, depth + 1)
    }
    return out
  }
  return value
}

/**
 * 文本里的凭据：工具返回是外部系统的原文，里面可能夹着
 * `Authorization: Bearer …`、`"password": "…"`、PEM 私钥。
 *
 * <p>先跑 Bearer / PEM 这两条结构明确的，再跑「敏感键 = 值」——
 * 顺序反了的话 `authorization: Bearer xxx` 只会打掉 `Bearer` 一词，
 * 后面的令牌原样留在正文里。
 */
const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
const BEARER_TOKEN = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi
const SECRET_PAIR =
  /((?:pass(?:word)?|passwd|pwd|secret|token|api[-_]?key|apikey|authorization|cookie|credential|private[-_]?key|access[-_]?key|client[-_]?secret)["']?\s*[=:]\s*)(["']?)([^\s"',;}\]]{2,})\2/gi

/** 文本级脱敏：工具返回与原始参数文本在展示前都要过这一道。 */
export function redactText(text: string): string {
  if (!text) return text
  return text
    .replace(PEM_PRIVATE_KEY, REDACTED)
    .replace(BEARER_TOKEN, `$1 ${REDACTED}`)
    .replace(SECRET_PAIR, (_match, prefix: string, quote: string) => {
      return `${prefix}${quote}${REDACTED}${quote}`
    })
}

/**
 * 参数值转成可展示的短文本：对象/数组用 JSON，长文本截断。
 *
 * <p>先脱敏再截断——反过来会把一个令牌从中间切开，前半截照样露出来。
 */
function formatArgValue(value: unknown, max = 220): string {
  let text: string
  if (typeof value === "string") {
    text = value
  } else if (value === null || value === undefined) {
    text = ""
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  text = redactText(text)
  if (text.length > max) return `${text.slice(0, max)}…`
  return text
}

/** 工具参数 → 脱敏后的键值对列表（嵌套敏感键同样打码）。 */
export function sanitizeToolArgs(
  args: Record<string, unknown> | undefined,
): { key: string; value: string }[] {
  if (!args) return []
  return Object.entries(args).map(([key, value]) => ({
    key,
    value: isSensitiveKey(key) ? REDACTED : formatArgValue(redactValue(value)),
  }))
}

/** 工具结果状态 → 步骤状态。只映射观察到的事实。 */
export function stateFromToolStatus(status: string | undefined): AgentStepState {
  switch ((status ?? "").toLowerCase()) {
    // 合并后的服务端词表（ToolStepContract）与原 #111 词表都要认：
    // succeeded/success 才等于「真的成功了」，其余一律不升级成 done。
    case "succeeded":
    case "success":
      return "done"
    case "running":
      return "running"
    case "awaiting-confirm":
      return "paused"
    case "error":
    case "failed":
    case "failure":
      return "error"
    case "timeout":
      return "timeout"
    case "cancelled":
    case "canceled":
    case "interrupted":
      return "cancelled"
    case "unknown":
      return "pending"
    default:
      // completed / 缺失 / 还不认识的 status：结果确实回来了，但成败未知。
      // 落成「完成」会把这个不确定性抹掉——宁可显示「已返回」。
      return "returned"
  }
}

/**
 * 把一段真实事件整理成步骤。
 *
 * <p>tool-request 逐工具调用各成一步；tool-response 先按 `toolCallId`
 * 精确配对，旧数据没有 id 时才退回到「第一个还没收到返回的步骤」。
 */
function toSteps(msg: StreamMessage, steps: AgentStep[]): AgentStep[] {
  switch (msg.type) {
    case "reasoning": {
      // 模型内部推理不是可核验的医学证据，标题如实说是「模型推理」。
      return [
        {
          id: msg.id,
          kind: "reasoning",
          label: "模型推理",
          state: "done",
          text: msg.content,
        },
      ]
    }

    case "tool-request": {
      const calls = msg.toolCalls ?? []
      if (calls.length === 0) {
        return [
          {
            id: msg.id,
            kind: "tool",
            label: toolLabel(msg.toolName),
            toolName: msg.toolName,
            toolCallId: msg.toolCallId,
            state: msg.toolStatus ? stateFromToolStatus(msg.toolStatus) : "running",
            args: [],
          },
        ]
      }
      // 一次请求里可能有多工具调用：各自成步，才能和各自的结果配对。
      return calls.map((call, index) => ({
        id: `${msg.id}:${index}`,
        kind: "tool" as const,
        label: toolLabel(call.name),
        toolName: call.name,
        toolCallId: call.id,
        // 状态回执可能直接落在请求帧上（content 恒空的状态增量），
        // 没有回执才按「执行中」处理，流结束时再按事实转成「未确认」。
        state: (msg.toolStatus ? stateFromToolStatus(msg.toolStatus) : "running") as AgentStepState,
        args: sanitizeToolArgs(call.args),
      }))
    }

    case "tool-response": {
      // 返回原文是外部系统的输出，展示前先过文本脱敏。
      const output = redactText(msg.content)
      const target = findPendingToolStep(steps, msg.toolCallId)
      if (target) {
        target.output = output
        target.received = true
        target.state = stateFromToolStatus(msg.toolStatus)
        return []
      }
      return [
        {
          id: msg.id,
          kind: "tool",
          label: toolLabel(msg.toolName),
          toolName: msg.toolName,
          toolCallId: msg.toolCallId,
          state: stateFromToolStatus(msg.toolStatus),
          output,
          received: true,
        },
      ]
    }

    case "confirm": {
      // tool-confirm 是图中断的终点卡：信息性暂停，没有确认回传端点，
      // 所以这里只做「已暂停」的事实陈述，不提供批准动作。
      return [
        {
          id: msg.id,
          kind: "confirm",
          label: "工具执行已暂停",
          state: "paused",
          note: msg.content,
        },
      ]
    }

    default:
      return []
  }
}

/**
 * 找这一步结果该落到哪个工具步骤上。
 *
 * <p>有 `toolCallId` 时精确匹配——多工具、乱序返回都不会串配。
 * 旧数据没有 id 时退回「第一个还没收到返回的步骤」，并且用 `received`
 * 而不是 `!output` 判断：空字符串结果也是已经返回。
 */
function findPendingToolStep(steps: AgentStep[], toolCallId?: string): AgentStep | undefined {
  if (toolCallId) {
    return steps.find(
      (step) => step.kind === "tool" && step.toolCallId === toolCallId,
    )
  }
  // 先进先出：旧数据里的工具是顺序执行的，第一条返回属于第一个还没回执的调用。
  // 取「最后一个未回执」会把多工具的第一步永远留在「未确认」。
  return steps.find((step) => step.kind === "tool" && !step.received)
}

/**
 * 线程分组：连续的过程事件合成一个过程块，其余保持消息原序。
 *
 * @param streaming 流是否仍在进行。仍在进行时，没有返回的工具步骤标成
 *   「执行中」；流已结束则标成「未确认」——不是「待返回」，后端不会为
 *   已经结束的回合补发回执，说「待返回」等于承诺一件不会发生的事。
 */
export function buildThread(
  messages: StreamMessage[],
  streaming: boolean,
): ThreadItem[] {
  const items: ThreadItem[] = []
  let index = 0

  while (index < messages.length) {
    const current = messages[index]
    if (!isProcessMessage(current)) {
      items.push({ type: "message", message: current })
      index += 1
      continue
    }

    // 一段连续的过程事件
    const steps: AgentStep[] = []
    const blockId = current.id
    while (index < messages.length && isProcessMessage(messages[index])) {
      steps.push(...toSteps(messages[index], steps))
      index += 1
    }

    if (steps.length > 0) {
      items.push({ type: "process", id: `process-${blockId}`, steps })
    }
  }

  // 收敛「执行中」：只有**当前这一段**可能是真的还在跑。
  //
  // <p>`streaming` 是页面级状态，代表「现在有请求在飞」，不是「这一块还在跑」。
  // 新回合一开始它就为真；如果照着它给所有过程块放行，上一回合那些本来该是
  // 「未确认」的步骤会集体退回「执行中」——看起来像历史回合又活过来了。
  // 判据收紧为：只有排在最后、后面再没有任何消息的那一块，才允许保留「执行中」。
  const lastItem = items.length > 0 ? items[items.length - 1] : undefined
  for (const item of items) {
    if (item.type !== "process") continue
    const mayStillRun = streaming && item === lastItem
    if (mayStillRun) continue
    for (const step of item.steps) {
      if (step.kind === "tool" && step.state === "running") {
        // 已有失败/成功结论的步骤保持原状；只把「没结论的」如实标成未确认。
        step.state = "pending"
      }
    }
  }

  return items
}

/** 步骤状态 → 中文标签。 */
export function stepStateLabel(state: AgentStepState): string {
  switch (state) {
    case "done":
      return "完成"
    case "returned":
      // 只陈述「结果回来了」，不替后端宣布成功。
      return "已返回"
    case "running":
      return "执行中"
    case "pending":
      // 「未确认」只陈述事实：没收到返回，不知道结果。
      // 不说「完成」，也不说「待返回」——那是在承诺一份不会到的回执。
      return "未确认"
    case "paused":
      return "已暂停"
    case "error":
      return "失败"
    case "timeout":
      return "超时"
    case "cancelled":
      return "已中断"
  }
}

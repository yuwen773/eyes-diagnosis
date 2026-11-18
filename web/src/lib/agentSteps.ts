/**
 * 执行过程（Thought Line）的数据层。
 *
 * <p>**这里只把已经真实发生过的 SSE 事件整理成步骤，不生成任何一步。**
 * 输入只有 `reasoning` / `tool-request` / `tool-response` / `tool-confirm`
 * 四类真实事件；没有事件就没有步骤。工具调用与它的返回在同一步里合并，
 * 用户看到的是「做了什么」，而不是两段互不相干的系统日志。
 *
 * <p>纯函数：输入消息数组，输出「消息 / 过程块」交替的线程结构。
 * 可单测，不碰 React。
 */

import type { StreamMessage } from "./agentStream"

/**
 * 步骤状态。
 *
 * <p>`done` / `failed` / `cancelled` 来自后端的状态回执（`toolStatus`）；
 * `running` 是还没有回执但流仍在跑；`paused` 是图中断的等待确认。
 *
 * <p>`pending` 是「流已结束、没有收到任何状态回执」，展示成「未确认」：
 * 既不是完成，也不是还在等——后端不会给已结束的回合补发回执。
 */
export type AgentStepState = "done" | "running" | "pending" | "paused" | "failed" | "cancelled"

export type AgentStepKind = "reasoning" | "tool" | "confirm"

export type AgentStep = {
  id: string
  kind: AgentStepKind
  /** 步骤标题：工具名 / 「模型推理」/「工具执行已暂停」。 */
  label: string
  state: AgentStepState
  /** 工具的原始标识（模型实际调用的函数名）。 */
  toolName?: string
  /** 后端工具调用 id：状态回执靠它归属到具体一步。 */
  toolCallId?: string
  /** 工具参数（键值对，已脱敏）。 */
  args?: { key: string; value: string }[]
  /** 工具返回原文。 */
  output?: string
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

/**
 * 把一段真实事件整理成步骤。
 *
 * <p>tool-request 与它之后的 tool-response 合并成同一步：步骤标题取工具名，
 * 有返回就是「完成」，还没收到返回就是「执行中」（流仍在跑）或「未确认」
 * （流已结束、工具没回）。
 */
/**
 * 后端状态回执 → 步骤状态。
 *
 * <p>有回执就以回执为准：成功的工具不能因为「没收到 tool-response 消息」而一直挂着
 * 「执行中 / 未确认」——`tool-result` 状态帧本来就不带正文（后端 content 恒为空）。
 * 没有回执（历史消息、旧后端）才退回类型推断。
 */
function stateOfToolStatus(status: StreamMessage["toolStatus"]): AgentStepState {
  switch (status) {
    case "succeeded":
      return "done"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "awaiting-confirm":
      return "paused"
    default:
      return "running"
  }
}
function toStep(
  msg: StreamMessage,
  steps: AgentStep[],
): AgentStep | null {
  switch (msg.type) {
    case "reasoning": {
      // 模型内部推理不是可核验的医学证据，标题如实说是「模型推理」。
      return {
        id: msg.id,
        kind: "reasoning",
        label: "模型推理",
        state: "done",
        text: msg.content,
      }
    }

    case "tool-request": {
      const calls = msg.toolCalls ?? []
      if (calls.length === 0) return null
      // 一次请求里可能有多工具调用：各自成步，标题带工具名。
      return {
        id: msg.id,
        kind: "tool",
        label: calls.map((c) => toolLabel(c.name)).join("、") || msg.toolName || "工具",
        toolName: calls.map((c) => c.name).join("、") || msg.toolName,
        toolCallId: msg.toolCallId,
        state: stateOfToolStatus(msg.toolStatus),
        args: sanitizeToolArgs(calls[0]?.args),
      }
    }

    case "tool-response": {
      // 归并到同一步未完成的工具调用上；找不到就自己成一步。
      // 返回原文是外部系统的输出，展示前先过文本脱敏。
      const output = redactText(msg.content)
      const pending = [...steps].reverse().find((s) => s.kind === "tool" && !s.output)
      if (pending) {
        pending.output = output
        pending.state = "done"
        return null
      }
      return {
        id: msg.id,
        kind: "tool",
        label: toolLabel(msg.toolName),
        toolName: msg.toolName,
        state: "done",
        output,
      }
    }

    case "confirm": {
      // tool-confirm 是图中断的终点卡：信息性暂停，没有确认回传端点，
      // 所以这里只做「已暂停」的事实陈述，不提供批准动作。
      return {
        id: msg.id,
        kind: "confirm",
        label: "工具执行已暂停",
        state: "paused",
        note: msg.content,
      }
    }

    default:
      return null
  }
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
      const step = toStep(messages[index], steps)
      if (step) steps.push(step)
      index += 1
    }

    // 流结束了：**所有**还没拿到返回的工具步骤都转成「未确认」。
    // 只看最后一个是不够的——一次请求可能连续调多个工具，前面的步骤
    // 会一直挂着「执行中」，像是永远没跑完。
    if (!streaming) {
      for (const step of steps) {
        if (step.kind === "tool" && step.state === "running") {
          step.state = "pending"
        }
      }
    }

    if (steps.length > 0) {
      items.push({ type: "process", id: `process-${blockId}`, steps })
    }
  }

  return items
}

/** 步骤状态 → 中文标签。 */
export function stepStateLabel(state: AgentStepState): string {
  switch (state) {
    case "done":
      return "完成"
    case "running":
      return "执行中"
    case "pending":
      // 「未确认」只陈述事实：没收到返回，不知道结果。
      // 不说「完成」，也不说「待返回」——那是在承诺一份不会到的回执。
      return "未确认"
    case "paused":
      return "已暂停"
    case "failed":
      // 只说失败，不复述错误码：错误分类由后端给，前端不解释成医学含义。
      return "失败"
    case "cancelled":
      return "已取消"
  }
}

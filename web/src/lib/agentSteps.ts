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

export type AgentStepState = "done" | "running" | "pending" | "paused"

export type AgentStepKind = "reasoning" | "tool" | "confirm"

export type AgentStep = {
  id: string
  kind: AgentStepKind
  /** 步骤标题：工具名 / 「模型推理」/「工具执行已暂停」。 */
  label: string
  state: AgentStepState
  /** 工具的原始标识（模型实际调用的函数名）。 */
  toolName?: string
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
 */
const SENSITIVE_KEY = /(pass|pwd|secret|token|api[-_]?key|authorization|cookie|credential)/i

/** 敏感值一律换成固定占位串，不保留长度信息。 */
export const REDACTED = "••••••"

/** 参数值转成可展示的短文本：对象/数组用 JSON，长文本截断。 */
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
  if (text.length > max) return `${text.slice(0, max)}…`
  return text
}

/** 工具参数 → 脱敏后的键值对列表。 */
export function sanitizeToolArgs(
  args: Record<string, unknown> | undefined,
): { key: string; value: string }[] {
  if (!args) return []
  return Object.entries(args).map(([key, value]) => ({
    key,
    value: SENSITIVE_KEY.test(key) ? REDACTED : formatArgValue(value),
  }))
}

/**
 * 把一段真实事件整理成步骤。
 *
 * <p>tool-request 与它之后的 tool-response 合并成同一步：步骤标题取工具名，
 * 有返回就是「完成」，还没收到返回就是「执行中」（流仍在跑）或「待返回」
 * （流已结束但工具没回）。
 */
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
        state: "running",
        args: sanitizeToolArgs(calls[0]?.args),
      }
    }

    case "tool-response": {
      // 归并到同一步未完成的工具调用上；找不到就自己成一步。
      const pending = [...steps].reverse().find((s) => s.kind === "tool" && !s.output)
      if (pending) {
        pending.output = msg.content
        pending.state = "done"
        return null
      }
      return {
        id: msg.id,
        kind: "tool",
        label: toolLabel(msg.toolName),
        toolName: msg.toolName,
        state: "done",
        output: msg.content,
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
 * @param streaming 流是否仍在进行。仍在进行时，最后一个没有返回的工具步骤
 *   标成「执行中」；流已结束则标成「待返回」——两者都不是假状态。
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

    // 流结束了但最后一步还没等到工具返回：如实标成「待返回」。
    if (!streaming) {
      const last = steps[steps.length - 1]
      if (last && last.kind === "tool" && last.state === "running") {
        last.state = "pending"
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
      return "待返回"
    case "paused":
      return "已暂停"
  }
}

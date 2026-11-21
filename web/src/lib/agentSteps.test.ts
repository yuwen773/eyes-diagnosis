// 执行过程的数据层契约：只由真实事件派生，不生成任何一步。
import { describe, expect, it } from "vitest"

import type { StreamMessage } from "./agentStream"
import {
  buildThread,
  processHeadline,
  REDACTED,
  sanitizeToolArgs,
  stepStateLabel,
  toolLabel,
  type AgentStep,
} from "./agentSteps"

function msg(partial: Partial<StreamMessage> & { id: string; type: StreamMessage["type"] }): StreamMessage {
  return { content: "", ...partial }
}

function stepsOf(items: ReturnType<typeof buildThread>): AgentStep[] {
  return items.flatMap((item) => (item.type === "process" ? item.steps : []))
}

describe("sanitizeToolArgs", () => {
  it("把疑似凭据的键值打码，不保留长度", () => {
    const args = sanitizeToolArgs({
      query: "白内障",
      apiKey: "sk-1234567890",
      password: "hunter2",
      authorization: "Bearer abc",
    })
    const byKey = Object.fromEntries(args.map((a) => [a.key, a.value]))
    expect(byKey.query).toBe("白内障")
    expect(byKey.apiKey).toBe(REDACTED)
    expect(byKey.password).toBe(REDACTED)
    expect(byKey.authorization).toBe(REDACTED)
  })

  it("长文本截断，结构化值序列化成 JSON", () => {
    const args = sanitizeToolArgs({ long: "x".repeat(500), obj: { a: 1 } })
    const byKey = Object.fromEntries(args.map((a) => [a.key, a.value]))
    expect(byKey.long.length).toBeLessThan(300)
    expect(byKey.long.endsWith("…")).toBe(true)
    expect(byKey.obj).toBe('{"a":1}')
  })

  it("没有参数时返回空列表", () => {
    expect(sanitizeToolArgs(undefined)).toEqual([])
    expect(sanitizeToolArgs({})).toEqual([])
  })

  it("嵌套对象与数组里的凭据同样打码", () => {
    const args = sanitizeToolArgs({
      config: { apiKey: "sk-live-123", region: "cn" },
      headers: [{ Authorization: "Bearer abcdef" }, { accept: "json" }],
      deep: { a: { b: { client_secret: "s3cr3t" } } },
    })
    const byKey = Object.fromEntries(args.map((a) => [a.key, a.value]))

    expect(byKey.config).toContain(REDACTED)
    expect(byKey.config).not.toContain("sk-live-123")
    // 非敏感字段照常显示：打码只针对凭据，不改参数形状。
    expect(byKey.config).toContain("cn")
    expect(byKey.headers).toContain(REDACTED)
    expect(byKey.headers).not.toContain("abcdef")
    expect(byKey.deep).toContain(REDACTED)
    expect(byKey.deep).not.toContain("s3cr3t")
  })

  it("非敏感嵌套结构原样保留", () => {
    const args = sanitizeToolArgs({ filter: { date: "2026", tags: ["眼底", "青光眼"] } })
    expect(args[0].value).toBe('{"date":"2026","tags":["眼底","青光眼"]}')
  })

  it("计数类键名不打码：max_tokens 是参数，不是凭据", () => {
    const args = sanitizeToolArgs({ max_tokens: 4096, token_count: 12 })
    const byKey = Object.fromEntries(args.map((a) => [a.key, a.value]))
    expect(byKey.max_tokens).toBe("4096")
    expect(byKey.token_count).toBe("12")
  })

  it("解析失败的原始参数文本也要脱敏，不能原样摆出去", () => {
    const args = sanitizeToolArgs({ _raw: 'apiKey="sk-live-999" region=cn' })
    expect(args[0].value).not.toContain("sk-live-999")
    expect(args[0].value).toContain(REDACTED)
  })

  it("深到离谱的结构不会递归爆栈", () => {
    let deep: Record<string, unknown> = { token: "t" }
    for (let i = 0; i < 40; i += 1) deep = { nested: deep }
    expect(() => sanitizeToolArgs({ deep })).not.toThrow()
  })
})

describe("toolLabel", () => {
  it("内置工具给中文说法，MCP 工具原样显示", () => {
    expect(toolLabel("searchDocuments")).toBe("检索知识库文档")
    expect(toolLabel("analyzeEyeImage")).toBe("分析眼底图像")
    expect(toolLabel("mcp__weather__forecast")).toBe("mcp__weather__forecast")
    expect(toolLabel(undefined)).toBe("工具")
  })
})

describe("buildThread", () => {
  it("没有事件就没有步骤——不凭空生成", () => {
    const items = buildThread([msg({ id: "u1", type: "user", content: "你好" })], false)
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe("message")
    expect(stepsOf(items)).toHaveLength(0)
  })

  it("推理步标为完成，并如实说是「模型推理」", () => {
    const items = buildThread([msg({ id: "r1", type: "reasoning", content: "先想一下" })], false)
    const steps = stepsOf(items)
    expect(steps).toHaveLength(1)
    expect(steps[0].kind).toBe("reasoning")
    expect(steps[0].label).toBe("模型推理")
    expect(steps[0].state).toBe("done")
    expect(steps[0].text).toBe("先想一下")
  })

  it("工具请求与它的返回合并成同一步", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: { query: "青光眼" } }] }),
        msg({
          id: "t2",
          type: "tool-response",
          content: "检索到 3 段文档",
          toolName: "searchDocuments",
          toolStatus: "success",
        }),
      ],
      false,
    )
    const steps = stepsOf(items)
    expect(steps).toHaveLength(1)
    expect(steps[0].label).toBe("检索知识库文档")
    expect(steps[0].toolName).toBe("searchDocuments")
    expect(steps[0].state).toBe("done")
    expect(steps[0].output).toBe("检索到 3 段文档")
    expect(steps[0].args).toEqual([{ key: "query", value: "青光眼" }])
  })

  it("历史回放：请求行带 toolCallId 时与结果行配对，不产生幽灵步骤", () => {
    // 回归：请求行若只落「模糊标签」而没有 toolCallId，回放时结果行配不上它，
    // 一次调用会显示成「工具/未确认 + 检索知识库文档/完成」两步。
    const items = buildThread(
      [
        msg({
          id: "h1",
          type: "tool-request",
          toolCallId: "call_1",
          toolCalls: [{ id: "call_1", name: "searchDocuments", args: {} }],
        }),
        msg({
          id: "h2",
          type: "tool-response",
          content: "检索到 3 段文档",
          toolName: "searchDocuments",
          toolCallId: "call_1",
          toolStatus: "succeeded",
        }),
      ],
      false,
    )
    const steps = stepsOf(items)
    expect(steps).toHaveLength(1)
    expect(steps[0].state).toBe("done")
    expect(steps[0].output).toBe("检索到 3 段文档")
  })

  it("历史回放：一次请求里的多个工具各自成步并按 id 配对", () => {
    const items = buildThread(
      [
        msg({
          id: "h3",
          type: "tool-request",
          toolCallId: "call_a",
          toolCalls: [
            { id: "call_a", name: "searchDocuments", args: {} },
            { id: "call_b", name: "analyzeEyeImage", args: {} },
          ],
        }),
        msg({ id: "h4", type: "tool-response", content: "3 段", toolCallId: "call_a", toolStatus: "succeeded" }),
        msg({ id: "h5", type: "tool-response", content: "失败", toolCallId: "call_b", toolStatus: "failed" }),
      ],
      false,
    )
    const steps = stepsOf(items)
    expect(steps).toHaveLength(2)
    expect(steps[0].state).toBe("done")
    expect(steps[1].state).toBe("error")
  })

  it("running 状态帧不冒充结果：不标已返回、不写空输出", () => {
    // 回归：后端把 running 帧也走 tool-result 通道发（content 恒空），
    // 一律标 received 会在「执行中」旁边写「工具返回了空结果」。
    const items = buildThread(
      [
        msg({
          id: "r1",
          type: "tool-request",
          toolCallId: "call_x",
          toolCalls: [{ id: "call_x", name: "searchDocuments", args: {} }],
        }),
        msg({ id: "r2", type: "tool-response", toolCallId: "call_x", toolStatus: "running", content: "" }),
      ],
      true,
    )
    const steps = stepsOf(items)
    expect(steps).toHaveLength(1)
    expect(steps[0].state).toBe("running")
    expect(steps[0].received).toBeFalsy()
    expect(steps[0].output).toBeUndefined()
  })

  it("有状态回执就以回执为准：succeeded / failed / cancelled 各自成态", () => {
    // 回归：合并进来的后端每个工具状态帧都带 toolCallId + toolStatus，content 恒为空，
    // 前端永远收不到 tool-response。只按消息类型推断会把成功的工具一直标成「未确认」。
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCallId: "a", toolStatus: "succeeded", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({ id: "t2", type: "tool-request", toolCallId: "b", toolStatus: "failed", toolCalls: [{ name: "analyzeEyeImage", args: {} }] }),
        msg({ id: "t3", type: "tool-request", toolCallId: "c", toolStatus: "cancelled", toolCalls: [{ name: "searchDocuments", args: {} }] }),
      ],
      false,
    )
    expect(stepsOf(items).map((s) => s.state)).toEqual(["done", "error", "cancelled"])
  })

  it("等待确认的回执标「已暂停」，不因为流结束被改写成「未确认」", () => {
    const items = buildThread(
      [msg({ id: "t1", type: "tool-request", toolCallId: "a", toolStatus: "awaiting-confirm", toolCalls: [{ name: "analyzeEyeImage", args: {} }] })],
      false,
    )
    expect(stepsOf(items)[0].state).toBe("paused")
  })
  it("流仍在跑时未返回的工具是「执行中」", () => {
    const items = buildThread(
      [msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] })],
      true,
    )
    expect(stepsOf(items)[0].state).toBe("running")
  })

  it("流结束了还没等到工具返回，如实标成「未确认」而不是「完成」", () => {
    const items = buildThread(
      [msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] })],
      false,
    )
    expect(stepsOf(items)[0].state).toBe("pending")
  })

  it("一次回合里多个工具都没回执时，全部转成「未确认」，不留「执行中」", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({ id: "t2", type: "tool-request", toolCalls: [{ name: "analyzeEyeImage", args: {} }] }),
        msg({ id: "t3", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] }),
      ],
      false,
    )
    expect(stepsOf(items).map((s) => s.state)).toEqual(["pending", "pending", "pending"])
  })

  it("多工具里只回来一条：旧数据按先进先出配对，其余仍是「未确认」", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({ id: "t2", type: "tool-request", toolCalls: [{ name: "analyzeEyeImage", args: {} }] }),
        msg({
          id: "t3",
          type: "tool-response",
          content: "检索到 3 段文档",
          toolName: "searchDocuments",
          toolStatus: "success",
        }),
      ],
      false,
    )
    const steps = stepsOf(items)
    expect(steps.map((s) => s.state)).toEqual(["done", "pending"])
    // 结果落在第一条调用上，不跳到最后一个未回执的步骤。
    expect(steps[0].output).toBe("检索到 3 段文档")
    expect(steps[1].output).toBeUndefined()
  })

  it("老数据没有 status：结果回来了但成败未知，显示「已返回」而不是「完成」", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({ id: "t2", type: "tool-response", content: "检索到 3 段文档", toolName: "searchDocuments" }),
      ],
      false,
    )
    const step = stepsOf(items)[0]
    expect(step.received).toBe(true)
    expect(step.state).toBe("returned")
    expect(stepStateLabel(step.state)).toBe("已返回")
  })

  it("工具返回原文里的凭据在展示前被抹掉", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({
          id: "t2",
          type: "tool-response",
          toolName: "searchDocuments",
          content:
            'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def\npassword=hunter2\n结果：3 段文档',
        }),
      ],
      false,
    )
    const step = stepsOf(items)[0]
    expect(step.output).not.toContain("hunter2")
    expect(step.output).not.toContain("eyJhbGciOiJIUzI1NiJ9")
    expect(step.output).toContain(REDACTED)
    // 正常内容不受影响：打码不能把工具结论一起吃掉。
    expect(step.output).toContain("结果：3 段文档")
  })

  it("确认事件是信息性暂停，不带批准动作", () => {
    const items = buildThread([msg({ id: "c1", type: "confirm", content: "工具: searchDocuments" })], false)
    const step = stepsOf(items)[0]
    expect(step.kind).toBe("confirm")
    expect(step.state).toBe("paused")
    expect(step.label).toBe("工具执行已暂停")
  })

  it("普通消息与过程块保持原序交替", () => {
    const items = buildThread(
      [
        msg({ id: "u1", type: "user", content: "问题" }),
        msg({ id: "r1", type: "reasoning", content: "推理" }),
        msg({ id: "a1", type: "assistant", content: "答案" }),
      ],
      false,
    )
    expect(items.map((i) => i.type)).toEqual(["message", "process", "message"])
  })

  it("连续的过程事件合成一个过程块", () => {
    const items = buildThread(
      [
        msg({ id: "r1", type: "reasoning", content: "推理" }),
        msg({ id: "r2", type: "reasoning", content: "更多推理" }),
      ],
      false,
    )
    expect(items).toHaveLength(1)
    expect(stepsOf(items)).toHaveLength(2)
  })

  it("一次请求里的多个工具调用各自成步，不与结果串配", () => {
    const items = buildThread(
      [
        msg({
          id: "t1",
          type: "tool-request",
          toolCalls: [
            { id: "call_a", name: "searchDocuments", args: { query: "青光眼" } },
            { id: "call_b", name: "analyzeEyeImage", args: { url: "u" } },
          ],
        }),
        // 乱序返回：先回 b，再回 a
        msg({ id: "r1", type: "tool-response", toolCallId: "call_b", toolStatus: "success", content: "图像结果" }),
        msg({ id: "r2", type: "tool-response", toolCallId: "call_a", toolStatus: "success", content: "文档结果" }),
      ],
      false,
    )
    const steps = stepsOf(items)
    expect(steps).toHaveLength(2)
    expect(steps[0].toolCallId).toBe("call_a")
    expect(steps[0].output).toBe("文档结果")
    expect(steps[0].state).toBe("done")
    expect(steps[1].toolCallId).toBe("call_b")
    expect(steps[1].output).toBe("图像结果")
  })

  it("空字符串结果也是「已返回」：不能停在未确认", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ id: "call_a", name: "searchDocuments", args: {} }] }),
        msg({ id: "r1", type: "tool-response", toolCallId: "call_a", toolStatus: "success", content: "" }),
      ],
      false,
    )
    const step = stepsOf(items)[0]
    expect(step.received).toBe(true)
    expect(step.output).toBe("")
    expect(step.state).toBe("done")
  })

  it("失败/超时/中断有真实观察依据，不伪装成完成", () => {
    const cases: { status: string; expected: AgentStep["state"] }[] = [
      { status: "error", expected: "error" },
      { status: "timeout", expected: "timeout" },
      { status: "cancelled", expected: "cancelled" },
      // 「框架返回了结果」不等于「执行成功」：completed 只够说「已返回」。
      { status: "completed", expected: "returned" },
      // 缺失 / 还不认识的 status 同样不落成完成——不确定性要显示出来。
      { status: "", expected: "returned" },
      { status: "partial", expected: "returned" },
    ]
    for (const { status, expected } of cases) {
      const items = buildThread(
        [
          msg({ id: "t1", type: "tool-request", toolCalls: [{ id: "call_a", name: "searchDocuments", args: {} }] }),
          msg({
            id: "r1",
            type: "tool-response",
            toolCallId: "call_a",
            toolStatus: status,
            content: status === "error" ? "检索失败" : "",
          }),
        ],
        false,
      )
      expect(stepsOf(items)[0].state).toBe(expected)
    }
  })

  it("流结束时只把仍在执行的步骤转为未确认，已有失败结论的保持原状", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ id: "call_a", name: "searchDocuments", args: {} }] }),
        msg({ id: "t2", type: "tool-request", toolCalls: [{ id: "call_b", name: "analyzeEyeImage", args: {} }] }),
        msg({ id: "r1", type: "tool-response", toolCallId: "call_a", toolStatus: "error", content: "失败" }),
      ],
      false,
    )
    expect(stepsOf(items).map((s) => s.state)).toEqual(["error", "pending"])
  })

  it("旧数据没有 toolCallId 时按顺序配对，且不会重复占用同一步", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({ id: "r1", type: "tool-response", content: "第一次" }),
        msg({ id: "r2", type: "tool-response", content: "第二次" }),
      ],
      false,
    )
    const steps = stepsOf(items)
    // 第一个回执吃掉唯一的请求步；第二个没有可配对的，独立成步。
    expect(steps).toHaveLength(2)
    expect(steps[0].output).toBe("第一次")
    expect(steps[0].received).toBe(true)
    expect(steps[1].output).toBe("第二次")
    expect(steps[1].received).toBe(true)
  })
})

describe("buildThread · 跨回合", () => {
  it("新回合开始后，上一回合没结论的工具步骤保持「未确认」，不退回「执行中」", () => {
    // 回归：streaming 是页面级状态，新回合一开始就为真。
    // 若照它给所有过程块放行，旧回合的步骤会集体变回「执行中」。
    const items = buildThread(
      [
        msg({ id: "u1", type: "user", content: "第一问" }),
        msg({ id: "t1", type: "tool-request", toolCallId: "a", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({ id: "a1", type: "assistant", content: "第一答" }),
        msg({ id: "u2", type: "user", content: "第二问" }),
        msg({ id: "t2", type: "tool-request", toolCallId: "b", toolCalls: [{ name: "searchDocuments", args: {} }] }),
      ],
      true,
    )
    const states = stepsOf(items).map((s) => s.state)
    expect(states).toEqual(["pending", "running"])
  })

  it("上一回合结束后又来了新消息，最后一块也不再算「执行中」", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCallId: "a", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({ id: "a1", type: "assistant", content: "答" }),
      ],
      true,
    )
    expect(stepsOf(items)[0].state).toBe("pending")
  })

  it("流仍在跑、且过程块就是最后一项时，才保留「执行中」", () => {
    const items = buildThread(
      [
        msg({ id: "u1", type: "user", content: "问" }),
        msg({ id: "r1", type: "reasoning", content: "想一想" }),
        msg({ id: "t1", type: "tool-request", toolCallId: "a", toolCalls: [{ name: "searchDocuments", args: {} }] }),
      ],
      true,
    )
    const toolStep = stepsOf(items).find((step) => step.kind === "tool")
    expect(toolStep?.state).toBe("running")
  })
})

describe("stepStateLabel", () => {
  it("每个状态都有中文标签", () => {
    expect(stepStateLabel("done")).toBe("完成")
    // 「已返回」与「完成」分开：前者只说明结果回来了，没说成败。
    expect(stepStateLabel("returned")).toBe("已返回")
    expect(stepStateLabel("running")).toBe("执行中")
    // 「未确认」只陈述「没收到返回」，不承诺还会收到回执。
    expect(stepStateLabel("pending")).toBe("未确认")
    expect(stepStateLabel("paused")).toBe("已暂停")
    expect(stepStateLabel("error")).toBe("失败")
    expect(stepStateLabel("timeout")).toBe("超时")
    expect(stepStateLabel("cancelled")).toBe("已中断")
  })
})

describe("stateFromToolResult（失败类别）", () => {
  it("failed + TIMEOUT 显示为超时，而不是笼统的失败", () => {
    const items = buildThread(
      [
        msg({ id: "r1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {}, id: "c1" }] }),
        msg({
          id: "r2",
          type: "tool-response",
          toolCallId: "c1",
          toolStatus: "failed",
          errorCategory: "TIMEOUT",
          toolName: "searchDocuments",
          content: "",
        }),
      ],
      false,
    )
    const [step] = stepsOf(items)
    expect(step.state).toBe("timeout")
    expect(step.errorCategory).toBe("TIMEOUT")
    expect(stepStateLabel(step.state)).toBe("超时")
  })

  it("failed + CANCELLED 显示为已中断", () => {
    const items = buildThread(
      [
        msg({ id: "r1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {}, id: "c1" }] }),
        msg({
          id: "r2",
          type: "tool-response",
          toolCallId: "c1",
          toolStatus: "failed",
          errorCategory: "CANCELLED",
          content: "",
        }),
      ],
      false,
    )
    const [step] = stepsOf(items)
    expect(step.state).toBe("cancelled")
    expect(stepStateLabel(step.state)).toBe("已中断")
  })

  it("failed + INVALID_OUTPUT 仍是失败，但类别保留给界面区分措辞", () => {
    const items = buildThread(
      [
        msg({ id: "r1", type: "tool-request", toolCalls: [{ name: "analyzeEyeImage", args: {}, id: "c1" }] }),
        msg({
          id: "r2",
          type: "tool-response",
          toolCallId: "c1",
          toolStatus: "failed",
          errorCategory: "INVALID_OUTPUT",
          content: "",
        }),
      ],
      false,
    )
    const [step] = stepsOf(items)
    expect(step.state).toBe("error")
    expect(step.errorCategory).toBe("INVALID_OUTPUT")
  })

  it("没有类别时保持普通失败，不猜", () => {
    const items = buildThread(
      [
        msg({ id: "r1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {}, id: "c1" }] }),
        msg({ id: "r2", type: "tool-response", toolCallId: "c1", toolStatus: "failed", content: "" }),
      ],
      false,
    )
    expect(stepsOf(items)[0].state).toBe("error")
  })
})

describe("processHeadline · 进行态与完成态", () => {
  const running = (partial: Partial<AgentStep>): AgentStep => ({
    id: "s1",
    kind: "tool",
    label: "检索知识库文档",
    state: "running",
    ...partial,
  })

  it("工具执行中按真实工具名说「正在做什么」，不显示原始函数名", () => {
    expect(processHeadline([running({ toolName: "searchDocuments" })], true)).toBe(
      "正在检索知识库文档…",
    )
    expect(processHeadline([running({ toolName: "analyzeEyeImage" })], true)).toBe(
      "正在分析眼底图像…",
    )
  })

  it("不认得的工具（用户自配 MCP）不硬译成中文动作", () => {
    expect(processHeadline([running({ toolName: "my_mcp_tool" })], true)).toBe("正在执行工具…")
  })

  it("推理进行中说「正在推理」", () => {
    expect(processHeadline([running({ kind: "reasoning", label: "模型推理" })], true)).toBe(
      "正在推理…",
    )
  })

  it("步骤都结束了但这一块仍是最后一块，才说「正在生成回答」", () => {
    const done: AgentStep = { id: "s1", kind: "tool", label: "检索", state: "done" }
    expect(processHeadline([done], true)).toBe("正在生成回答…")
    expect(processHeadline([done], false)).toBe("执行过程 · 1 个工具调用")
  })

  it("结束后按真实终态计数：失败优先于未确认，未确认优先于普通计数", () => {
    const failed: AgentStep = { id: "s1", kind: "tool", label: "检索", state: "error" }
    const pending: AgentStep = { id: "s2", kind: "tool", label: "检索", state: "pending" }
    const done: AgentStep = { id: "s3", kind: "tool", label: "检索", state: "done" }
    expect(processHeadline([failed, done], false)).toBe("执行过程 · 1 步未完成")
    expect(processHeadline([pending, done], false)).toBe("执行过程 · 1 步未确认")
    expect(processHeadline([done, done], false)).toBe("执行过程 · 2 个工具调用")
    expect(processHeadline([], false)).toBe("执行过程")
  })

  it("buildThread 标记的 active 只属于最后一块，历史块不会假装在跑", () => {
    const items = buildThread(
      [
        msg({ id: "r1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {}, id: "c1" }] }),
        msg({ id: "a1", type: "assistant", content: "第一轮回答" }),
        msg({ id: "r2", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {}, id: "c2" }] }),
      ],
      true,
    )
    const processes = items.filter((item) => item.type === "process")
    expect(processes).toHaveLength(2)
    expect(processes[0].type === "process" && processes[0].active).toBe(false)
    expect(processes[1].type === "process" && processes[1].active).toBe(true)
  })
})

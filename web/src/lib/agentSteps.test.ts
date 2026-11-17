// 执行过程的数据层契约：只由真实事件派生，不生成任何一步。
import { describe, expect, it } from "vitest"

import type { StreamMessage } from "./agentStream"
import {
  buildThread,
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
        msg({ id: "t2", type: "tool-response", content: "检索到 3 段文档", toolName: "searchDocuments" }),
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

  it("多工具里只有最后一个收到返回：其余仍是「未确认」，不会一起算完成", () => {
    const items = buildThread(
      [
        msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] }),
        msg({ id: "t2", type: "tool-request", toolCalls: [{ name: "analyzeEyeImage", args: {} }] }),
        msg({ id: "t3", type: "tool-response", content: "分析完成", toolName: "analyzeEyeImage" }),
      ],
      false,
    )
    expect(stepsOf(items).map((s) => s.state)).toEqual(["pending", "done"])
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
})

describe("stepStateLabel", () => {
  it("每个状态都有中文标签", () => {
    expect(stepStateLabel("done")).toBe("完成")
    expect(stepStateLabel("running")).toBe("执行中")
    // 「未确认」只陈述「没收到返回」，不承诺还会收到回执。
    expect(stepStateLabel("pending")).toBe("未确认")
    expect(stepStateLabel("paused")).toBe("已暂停")
  })
})

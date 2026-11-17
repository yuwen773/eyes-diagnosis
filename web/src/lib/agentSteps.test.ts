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

  it("流结束了还没等到工具返回，如实标成「待返回」而不是「完成」", () => {
    const items = buildThread(
      [msg({ id: "t1", type: "tool-request", toolCalls: [{ name: "searchDocuments", args: {} }] })],
      false,
    )
    expect(stepsOf(items)[0].state).toBe("pending")
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
    expect(stepStateLabel("pending")).toBe("待返回")
    expect(stepStateLabel("paused")).toBe("已暂停")
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { ThoughtLine } from "./ThoughtLine"
import type { AgentStep } from "@/lib/agentSteps"

afterEach(() => {
  cleanup()
})

const reasoningStep: AgentStep = {
  id: "r1",
  kind: "reasoning",
  label: "模型推理",
  state: "done",
  text: "先看有没有文献支持",
}

const runningToolStep: AgentStep = {
  id: "t1",
  kind: "tool",
  label: "检索知识库文档",
  toolName: "searchDocuments",
  state: "running",
  args: [{ key: "query", value: "白内障" }],
}

const doneToolStep: AgentStep = {
  id: "t2",
  kind: "tool",
  label: "检索知识库文档",
  toolName: "searchDocuments",
  state: "done",
  args: [{ key: "query", value: "白内障" }],
  output: "检索到 3 段文档",
}

const pausedStep: AgentStep = {
  id: "c1",
  kind: "confirm",
  label: "工具执行已暂停",
  state: "paused",
  note: "工具: searchDocuments",
}

describe("ThoughtLine", () => {
  it("汇总标题只统计真实的工具调用", () => {
    render(<ThoughtLine steps={[reasoningStep, runningToolStep]} />)
    expect(screen.getByText("执行过程 · 1 个工具调用")).toBeTruthy()
  })

  it("只有推理时汇总标题不谎报工具数", () => {
    render(<ThoughtLine steps={[reasoningStep]} />)
    expect(screen.getByText("执行过程")).toBeTruthy()
  })

  it("运行中与已完成的状态可区分", () => {
    render(<ThoughtLine steps={[runningToolStep, doneToolStep]} />)
    expect(screen.getByText("执行中")).toBeTruthy()
    expect(screen.getByText("完成")).toBeTruthy()
  })

  it("工具给中文说法，同时留出原始函数名", () => {
    render(<ThoughtLine steps={[runningToolStep]} />)
    expect(screen.getByText("检索知识库文档")).toBeTruthy()
    expect(screen.getByText("searchDocuments")).toBeTruthy()
  })

  it("默认折叠：原始参数与返回不抢正文位置，展开才出现", () => {
    render(<ThoughtLine steps={[doneToolStep]} />)
    expect(screen.queryByText("检索到 3 段文档")).toBeNull()
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    expect(screen.getByText("检索到 3 段文档")).toBeTruthy()
    expect(screen.getByText("query")).toBeTruthy()
  })

  it("推理正文展开后按 Markdown 渲染", () => {
    render(<ThoughtLine steps={[reasoningStep]} />)
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    const body = document.querySelector(".thought__reasoning")
    expect(body).toBeTruthy()
    expect(body?.innerHTML).toContain("先看有没有文献支持")
  })

  it("推理一步如实标为模型推理，不冒充医学证据", () => {
    render(<ThoughtLine steps={[reasoningStep]} />)
    expect(screen.getByText("模型推理")).toBeTruthy()
    expect(screen.queryByText(/文献|证据|来源/)).toBeNull()
  })

  it("暂停步只做事实陈述，不提供批准动作", () => {
    render(<ThoughtLine steps={[pausedStep]} />)
    expect(screen.getByText("工具执行已暂停")).toBeTruthy()
    // 详情默认折叠，展开后是事实陈述 + 一句继续提示，没有批准按钮。
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    expect(screen.getByText(/如需继续，请直接发送下一条消息/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /批准|同意|确认继续|放行/ })).toBeNull()
  })

  it("没有步骤时不渲染任何东西", () => {
    const { container } = render(<ThoughtLine steps={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

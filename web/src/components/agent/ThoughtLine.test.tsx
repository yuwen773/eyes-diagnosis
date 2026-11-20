// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

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

  it("流结束时没有回执的工具步标「未确认」，不谎报完成也不承诺回执", () => {
    const pendingStep: AgentStep = {
      id: "t9",
      kind: "tool",
      label: "分析眼底图像",
      toolName: "analyzeEyeImage",
      state: "pending",
      args: [{ key: "imageUrl", value: "https://cos.example/a.jpg" }],
    }
    render(<ThoughtLine steps={[pendingStep]} />)

    expect(screen.getByText("未确认")).toBeTruthy()
    expect(screen.queryByText("完成")).toBeNull()
    // 「待返回」是在承诺一份不会到的回执——后端不会给已结束的回合补发。
    expect(screen.queryByText("待返回")).toBeNull()

    // 没有参数/返回也能展开：那里写着为什么没有结果。
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    expect(screen.getByText(/没有收到这个工具的返回/)).toBeTruthy()
  })

  it("没有参数也没有返回的未确认步骤同样可以展开看原因", () => {
    const bare: AgentStep = {
      id: "t10",
      kind: "tool",
      label: "检索知识库文档",
      state: "pending",
    }
    render(<ThoughtLine steps={[bare]} />)
    const head = screen.getByRole("button", { expanded: false })
    expect(head.hasAttribute("disabled")).toBe(false)
    fireEvent.click(head)
    expect(screen.getByText(/无法确认它是否执行完成/)).toBeTruthy()
  })

  it("运行中只报真实已用时长，不编造百分比或「预计剩余」", () => {
    vi.useFakeTimers()
    try {
      render(<ThoughtLine steps={[runningToolStep]} />)
      // 第一秒之前不摆一个「0s」出来假装在动。
      expect(document.querySelector(".thought__elapsed")).toBeNull()
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(document.querySelector(".thought__elapsed")?.textContent).toBe("3s")
      expect(screen.queryByText(/%/)).toBeNull()
      expect(screen.queryByText(/预计|剩余/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("换一个工具继续跑时读数重新起算，不把上一轮的时长带过去", () => {
    // 一次更新里「第一个 done、第二个 running」是真实会发生的：只按运行中的步数
    // 做依赖，计数恒为 1，新步骤会直接显示上一轮的 3s。
    vi.useFakeTimers()
    try {
      const { rerender } = render(<ThoughtLine steps={[runningToolStep]} />)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(document.querySelector(".thought__elapsed")?.textContent).toBe("3s")

      const nextRunning: AgentStep = { ...runningToolStep, id: "t99", label: "检索知识库文档" }
      rerender(<ThoughtLine steps={[doneToolStep, nextRunning]} />)
      // 换步后的第一帧不能沿用上一轮的 3s。
      expect(document.querySelector(".thought__elapsed")).toBeNull()
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(document.querySelector(".thought__elapsed")?.textContent).toBe("2s")
    } finally {
      vi.useRealTimers()
    }
  })

  it("并发两个工具时各算各的：后开始的步骤不把先开始的读数清零", () => {
    // 一次请求可能连续调多个工具，前面的步骤会一直挂着「执行中」。
    vi.useFakeTimers()
    try {
      const second: AgentStep = { ...runningToolStep, id: "t98", label: "检索知识库文档" }
      const { rerender } = render(<ThoughtLine steps={[runningToolStep]} />)
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(document.querySelector(".thought__elapsed")?.textContent).toBe("2s")

      rerender(<ThoughtLine steps={[runningToolStep, second]} />)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      const readings = Array.from(document.querySelectorAll(".thought__elapsed")).map(
        (node) => node.textContent,
      )
      expect(readings).toEqual(["3s", "1s"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("已完成 / 未确认的步骤不显示计时", () => {
    render(<ThoughtLine steps={[doneToolStep]} />)
    expect(document.querySelector(".thought__elapsed")).toBeNull()
  })

  it("没有步骤时不渲染任何东西", () => {
    const { container } = render(<ThoughtLine steps={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("ThoughtLine · 失败终态", () => {
  it("超时步骤说明超时，且不再说「工具返回了空结果」", () => {
    const timeoutStep: AgentStep = {
      id: "t9",
      kind: "tool",
      label: "检索知识库文档",
      toolName: "searchDocuments",
      state: "timeout",
      errorCategory: "TIMEOUT",
      received: true,
      output: "",
    }
    render(<ThoughtLine steps={[timeoutStep]} />)
    fireEvent.click(screen.getByRole("button", { name: /检索知识库文档/ }))
    expect(screen.getByText(/工具执行超时/)).toBeTruthy()
    expect(screen.queryByText("工具返回了空结果。")).toBeNull()
  })

  it("无效输出用「内容不可用」措辞，而不是笼统的工具错误", () => {
    const invalidStep: AgentStep = {
      id: "t10",
      kind: "tool",
      label: "分析眼底图像",
      toolName: "analyzeEyeImage",
      state: "error",
      errorCategory: "INVALID_OUTPUT",
      received: true,
      output: "",
    }
    render(<ThoughtLine steps={[invalidStep]} />)
    fireEvent.click(screen.getByRole("button", { name: /分析眼底图像/ }))
    expect(screen.getByText(/工具返回的内容不可用/)).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { AssistantMessage } from "./AssistantMessage"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function assistant(over: Partial<Parameters<typeof AssistantMessage>[0]["msg"]> = {}) {
  return {
    id: "a1",
    type: "assistant" as const,
    content: "",
    ...over,
  }
}

describe("AssistantMessage", () => {
  it("流式期间就是富文本：标题与粗体立刻成形，不等收口", () => {
    const { container } = render(
      <AssistantMessage msg={assistant({ content: "## 初步判断\n\n这是**重点**。", isLoading: true })} />,
    )
    const body = container.querySelector(".agent-msg__body")
    expect(body?.querySelector("h2")).toBeTruthy()
    expect(body?.querySelector("strong")?.textContent).toBe("重点")
    // 流式光标与正文是兄弟节点，不会混进 Markdown 内容里。
    expect(body?.querySelector(".caret-blink")).toBeTruthy()
  })

  it("结束后不再显示流式光标", () => {
    const { container } = render(<AssistantMessage msg={assistant({ content: "答" })} />)
    expect(container.querySelector(".caret-blink")).toBeNull()
    expect(container.querySelector(".is-streaming")).toBeNull()
  })

  it("代码块保留复制按钮，并能取到 data-code 的原文", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    const { container } = render(
      <AssistantMessage msg={assistant({ content: "```python\nprint(1)\n```" })} />,
    )
    const btn = container.querySelector<HTMLButtonElement>(".copy-btn")
    expect(btn).toBeTruthy()
    fireEvent.click(btn as HTMLButtonElement)
    // 高亮输出末尾带一个换行，复制进去的原文一致即可。
    const copied = writeText.mock.calls[0][0] as string
    expect(copied.trim()).toBe("print(1)")
  })

  it("净化后的正文不含脚本或事件属性", () => {
    const { container } = render(
      <AssistantMessage
        msg={assistant({ content: '<img src=x onerror="alert(1)"> <script>alert(1)</script>' })}
      />,
    )
    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("[onerror]")).toBeNull()
  })

  it("没有服务端时间就不显示时间，不拿本地时钟冒充", () => {
    const { container } = render(<AssistantMessage msg={assistant({ content: "答" })} />)
    expect(container.querySelector(".agent-author__time")).toBeNull()
  })

  it("有服务端时间时如实显示", () => {
    const { container } = render(
      <AssistantMessage msg={assistant({ content: "答", time: "18:20" })} />,
    )
    expect(container.querySelector(".agent-author__time")?.textContent).toBe("18:20")
  })
})

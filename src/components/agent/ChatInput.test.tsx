// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ChatInput } from "@/components/agent/ChatInput"

afterEach(() => {
  cleanup()
})

function setup(streaming: boolean) {
  const onSend = vi.fn()
  const onStop = vi.fn()
  render(
    <ChatInput
      disabled={false}
      streaming={streaming}
      onSend={onSend}
      onStop={onStop}
    />,
  )
  return { onSend, onStop, textarea: screen.getByPlaceholderText(/描述症状/) as HTMLTextAreaElement }
}

describe("ChatInput", () => {
  it("流式期间按 Enter 不发送、也不清空已输入的文字", () => {
    const { onSend, textarea } = setup(true)
    fireEvent.change(textarea, { target: { value: "追问一句" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    expect(onSend).not.toHaveBeenCalled()
    expect((textarea as HTMLTextAreaElement).value).toBe("追问一句")
  })

  it("非流式时 Enter 发送并清空", () => {
    const { onSend, textarea } = setup(false)
    fireEvent.change(textarea, { target: { value: "你好" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0]).toBe("你好")
    expect(textarea.value).toBe("")
  })

  it("中文输入法组字中的 Enter 不发送", () => {
    const { onSend, textarea } = setup(false)
    fireEvent.change(textarea, { target: { value: "你好" } })
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true })

    expect(onSend).not.toHaveBeenCalled()
    expect(textarea.value).toBe("你好")
  })

  it("流式期间显示的是停止按钮", () => {
    const { onStop } = setup(true)
    fireEvent.click(screen.getByText("停止"))
    expect(onStop).toHaveBeenCalled()
  })
})

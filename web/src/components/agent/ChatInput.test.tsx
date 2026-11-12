// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { act, createRef } from "react"
import { ChatInput, type ChatInputHandle } from "./ChatInput"
import { loadDraft, saveDraft } from "@/lib/agentDraft"

vi.mock("@/lib/agentUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agentUpload")>()),
}))

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

function renderInput(props: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(true)
  const onStop = vi.fn()
  const ref = createRef<ChatInputHandle>()
  render(
    <ChatInput
      ref={ref}
      disabled={false}
      streaming={false}
      onSend={onSend}
      onStop={onStop}
      {...props}
    />,
  )
  return { onSend, onStop, ref }
}

describe("ChatInput", () => {
  it("pickImage() 在调用栈里同步点开文件对话框（WebKit 手势要求）", () => {
    const { ref } = renderInput()
    let opened = 0
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(function (this: HTMLInputElement) {
        if (this.type === "file") opened += 1
      })
    ref.current?.pickImage()
    expect(opened).toBe(1)
    clickSpy.mockRestore()
  })

  it("prefill() 把引导句写进输入框并存草稿，不发送", async () => {
    const { onSend, ref } = renderInput()
    await act(async () => {
      ref.current?.prefill("帮我解读这张眼底照片")
    })
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "帮我解读这张眼底照片",
    )
    expect(loadDraft()).toBe("帮我解读这张眼底照片")
    expect(onSend).not.toHaveBeenCalled()
  })

  it("只有附件没有文字时可以发送（图片本身就是问题）", async () => {
    const { onSend } = renderInput()
    const file = new File(["x"], "fundus.jpg", { type: "image/jpeg" })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    const send = screen.getByRole("button", { name: "发送" })
    expect(send.hasAttribute("disabled")).toBe(false)
    await act(async () => {
      fireEvent.click(send)
    })
    expect(onSend).toHaveBeenCalledWith("", [file])
  })

  it("已存的草稿启动时不丢", () => {
    saveDraft("上次没发完的一句话")
    renderInput()
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "上次没发完的一句话",
    )
  })
})

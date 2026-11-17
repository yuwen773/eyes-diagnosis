// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { act, createRef, StrictMode } from "react"
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

  it("页面关闭/刷新（pagehide）时把还在防抖窗口里的草稿补上", () => {
    vi.useFakeTimers()
    try {
      renderInput()
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "还没发出去的半句话" },
      })
      // 还在 300ms 防抖窗口里：字只在内存里，落盘要等定时器或页面离开。
      expect(loadDraft()).toBe("")
      window.dispatchEvent(new Event("pagehide"))
      expect(loadDraft()).toBe("还没发出去的半句话")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("ChatInput 发送与停止（既有行为）", () => {
  function setup(streaming: boolean, sent = true) {
    const onSend = vi.fn().mockResolvedValue(sent)
    const onStop = vi.fn()
    render(
      <ChatInput
        disabled={false}
        streaming={streaming}
        onSend={onSend}
        onStop={onStop}
      />,
    )
    return {
      onSend,
      onStop,
      textarea: screen.getByPlaceholderText(/Enter 发送/) as HTMLTextAreaElement,
    }
  }

  it("流式期间按 Enter 不发送、也不清空已输入的文字", () => {
    const { onSend, textarea } = setup(true)
    fireEvent.change(textarea, { target: { value: "追问一句" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    expect(onSend).not.toHaveBeenCalled()
    expect((textarea as HTMLTextAreaElement).value).toBe("追问一句")
    // 流式期间说的是「助手正在回复」，不是「正在发送」——用户等的是回答。
    expect(screen.getByText("助手正在回复，完成后即可发送")).toBeTruthy()
  })

  it("非流式时 Enter 发送并清空", async () => {
    const { onSend, textarea } = setup(false)
    fireEvent.change(textarea, { target: { value: "你好" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(textarea.value).toBe(""))
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0]).toBe("你好")
  })

  it("发送成功后输入框立刻清空（消息已经在气泡里，不说两遍）", async () => {
    const { onSend, textarea } = setup(false)
    fireEvent.change(textarea, { target: { value: "去问医生" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(textarea.value).toBe(""))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it("发送失败时保留文字与附件，草稿不清", async () => {
    const { onSend, textarea } = setup(false, false)
    fireEvent.change(textarea, { target: { value: "别丢我" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(textarea.value).toBe("别丢我")
    expect(screen.getByText("发送没成功，内容已保留，可以重试")).toBeTruthy()
  })

  it("Shift+Enter 换行，不发送", () => {
    const { onSend, textarea } = setup(false)
    fireEvent.change(textarea, { target: { value: "第一行" } })
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })

    expect(onSend).not.toHaveBeenCalled()
    expect((textarea as HTMLTextAreaElement).value).toBe("第一行")
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
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }))
    expect(onStop).toHaveBeenCalled()
  })
})

describe("ChatInput 发送互斥", () => {
  it("上传/发送进行中再按 Enter 不重复提交，新输入留在框里", async () => {
    let resolveSend!: (value: boolean) => void
    const onSend = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve
        }),
    )
    render(
      <ChatInput disabled={false} streaming={false} onSend={onSend} onStop={vi.fn()} />,
    )
    const textarea = screen.getByPlaceholderText(/Enter 发送/) as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: "第一句" } })
    fireEvent.keyDown(textarea, { key: "Enter" })
    expect(onSend).toHaveBeenCalledTimes(1)

    // 上传还没结束、流还没开始（此时 streaming 仍是 false）：再按一次回车
    // 不能并发发出第二条消息。
    fireEvent.change(textarea, { target: { value: "第二句" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    expect(onSend).toHaveBeenCalledTimes(1)
    // 被拦下的输入留在框里，不吞。
    expect(textarea.value).toBe("第二句")
    expect(screen.getByText("正在发送，请稍候")).toBeTruthy()

    await act(async () => {
      resolveSend(true)
    })
    // 发送落定后互斥解除：这句还能再发。
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})

describe("ChatInput 附件 Blob URL 生命周期", () => {
  function stubBlobUrls() {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-1")
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    return { created, revoked }
  }

  async function attachOne() {
    const file = new File(["x"], "fundus.jpg", { type: "image/jpeg" })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    return file
  }

  it("StrictMode 下卸载仍然回收未发送的预览 URL（且只回收一次）", async () => {
    const { revoked } = stubBlobUrls()
    try {
      const { unmount } = render(
        <StrictMode>
          <ChatInput disabled={false} streaming={false} onSend={vi.fn()} onStop={vi.fn()} />
        </StrictMode>,
      )
      await attachOne()

      unmount()
      expect(revoked).toHaveBeenCalledWith("blob:preview-1")
      expect(revoked).toHaveBeenCalledTimes(1)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it("发送失败回退的附件不会被提前回收（预览仍可用），卸载时才回收", async () => {
    const { revoked } = stubBlobUrls()
    try {
      const onSend = vi.fn().mockResolvedValue(false)
      const { unmount } = render(
        <ChatInput disabled={false} streaming={false} onSend={onSend} onStop={vi.fn()} />,
      )
      await attachOne()

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "发送" }))
      })

      expect(onSend).toHaveBeenCalledTimes(1)
      // 失败回退：附件还在输入区，预览 URL 不能在这时被吊销。
      expect(screen.getByRole("button", { name: /移除 fundus\.jpg/ })).toBeTruthy()
      expect(revoked).not.toHaveBeenCalled()

      unmount()
      expect(revoked).toHaveBeenCalledWith("blob:preview-1")
    } finally {
      vi.restoreAllMocks()
    }
  })

  it("发送成功的附件当场回收，卸载时不会再重复回收", async () => {
    const { revoked } = stubBlobUrls()
    try {
      const onSend = vi.fn().mockResolvedValue(true)
      const { unmount } = render(
        <ChatInput disabled={false} streaming={false} onSend={onSend} onStop={vi.fn()} />,
      )
      await attachOne()

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "发送" }))
      })

      expect(revoked).toHaveBeenCalledTimes(1)
      unmount()
      // 已经发出去的附件不再挂在 state 上，卸载清理不会重复吊销。
      expect(revoked).toHaveBeenCalledTimes(1)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

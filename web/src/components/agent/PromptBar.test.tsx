// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"

import { PromptBar } from "./PromptBar"
import type { Attachment } from "@/lib/agentAttachments"

afterEach(() => {
  cleanup()
})

function renderBar(props: Partial<Parameters<typeof PromptBar>[0]> = {}) {
  const onTextChange = vi.fn()
  const onRemoveAttachment = vi.fn()
  const onPickFiles = vi.fn()
  const onSubmit = vi.fn()
  const onStop = vi.fn()
  render(
    <PromptBar
      text=""
      onTextChange={onTextChange}
      attachments={[]}
      onRemoveAttachment={onRemoveAttachment}
      onPickFiles={onPickFiles}
      onSubmit={onSubmit}
      onStop={onStop}
      streaming={false}
      disabled={false}
      canSend={false}
      hint=""
      placeholder="输入问题，Enter 发送"
      focused={false}
      onFocusedChange={vi.fn()}
      textareaRef={createRef<HTMLTextAreaElement>()}
      fileInputRef={createRef<HTMLInputElement>()}
      onFileChange={vi.fn()}
      onPaste={vi.fn()}
      onKeyDown={vi.fn()}
      {...props}
    />,
  )
  return { onTextChange, onRemoveAttachment, onPickFiles, onSubmit, onStop }
}

describe("PromptBar", () => {
  it("输入区是多行文本框，不是底部工具条", () => {
    const onKeyDown = vi.fn()
    renderBar({ onKeyDown })
    const box = screen.getByRole("textbox") as HTMLTextAreaElement
    // 必须是 textarea 而不是 input：多行输入是硬要求。
    expect(box.tagName).toBe("TEXTAREA")
    // Shift+Enter 原样透传（不被拦下），换行才不会被 PromptBar 吃掉。
    const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
    fireEvent(box, event)
    expect(onKeyDown).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("没有内容时发送键禁用", () => {
    renderBar({ canSend: false })
    expect(screen.getByRole("button", { name: "发送" }).hasAttribute("disabled")).toBe(true)
  })

  it("有内容时发送键可用并回调提交", () => {
    const { onSubmit } = renderBar({ canSend: true })
    const send = screen.getByRole("button", { name: "发送" })
    expect(send.hasAttribute("disabled")).toBe(false)
    fireEvent.click(send)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("流式期间换成停止键，点它调 onStop 而不是提交", () => {
    const { onStop, onSubmit } = renderBar({ streaming: true })
    expect(screen.queryByRole("button", { name: "发送" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("附件芯片显示缩略图与文件名，可以移除", () => {
    const attachment: Attachment = {
      id: "a1",
      name: "fundus.jpg",
      url: "blob:fake",
      file: new File(["x"], "fundus.jpg", { type: "image/jpeg" }),
    }
    const { onRemoveAttachment } = renderBar({ attachments: [attachment] })
    expect(screen.getByAltText("fundus.jpg")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "移除 fundus.jpg" }))
    expect(onRemoveAttachment).toHaveBeenCalledWith("a1")
  })

  it("添加图片按钮回调 onPickFiles", () => {
    const { onPickFiles } = renderBar()
    fireEvent.click(screen.getByRole("button", { name: "添加图片" }))
    expect(onPickFiles).toHaveBeenCalledTimes(1)
  })

  it("失败提示占位但不永久占位", () => {
    const { unmount } = render(
      <PromptBar
        text=""
        onTextChange={vi.fn()}
        attachments={[]}
        onRemoveAttachment={vi.fn()}
        onPickFiles={vi.fn()}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        streaming={false}
        disabled={false}
        canSend={false}
        hint="发送没成功，内容已保留，可以重试"
        placeholder=""
        focused={false}
        onFocusedChange={vi.fn()}
        textareaRef={createRef<HTMLTextAreaElement>()}
        fileInputRef={createRef<HTMLInputElement>()}
        onFileChange={vi.fn()}
        onPaste={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    )
    expect(screen.getByRole("status").textContent).toContain("发送没成功")
    unmount()
  })

  it("AI 免责声明常驻", () => {
    renderBar()
    expect(screen.getByText(/不能替代执业医师/)).toBeTruthy()
  })

  // 后端没有这些契约，界面也就不能出现——写死成回归护栏。
  it("不提供模型选择 / 推理强度 / 语音 / 知识库切换等后端没有的控件", () => {
    renderBar()
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.queryByRole("slider")).toBeNull()
    expect(screen.queryByRole("radio")).toBeNull()
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.queryByLabelText(/模型/)).toBeNull()
    expect(screen.queryByLabelText(/推理/)).toBeNull()
    expect(screen.queryByLabelText(/语音|麦克风/)).toBeNull()
    expect(screen.queryByLabelText(/知识库/)).toBeNull()
  })
})

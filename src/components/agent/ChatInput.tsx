import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react"
import { addFiles, removeById, type Attachment } from "@/lib/agentAttachments"

/** 自适应高度上限。 */
const MAX_TEXTAREA_HEIGHT = 160

/**
 * 输入区：自适应 textarea + 粘贴图片附件 + 发送/停止。
 * Enter 发送 / Shift+Enter 换行；中文输入法组字中的 Enter 不发送（isComposing）。
 */
export function ChatInput({
  disabled,
  streaming,
  onSend,
  onStop,
}: {
  disabled: boolean
  streaming: boolean
  onSend: (text: string, files: File[]) => void
  onStop: () => void
}) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自适应高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [text])

  // 组件卸载时回收仍未发送的预览 URL
  useEffect(() => {
    return () => {
      setAttachments((prev) => {
        prev.forEach((a) => URL.revokeObjectURL(a.url))
        return []
      })
    }
  }, [])

  function submit() {
    const trimmed = text.trim()
    if ((!trimmed && attachments.length === 0) || disabled) return
    onSend(trimmed, attachments.map((a) => a.file))
    setText("")
    setAttachments([])
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return
    // 中文输入法组字确认的 Enter 不发送
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(e.clipboardData.files)
    if (pasted.length === 0) return
    e.preventDefault()
    setAttachments((prev) => addFiles(prev, pasted, (f) => URL.createObjectURL(f)))
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return removeById(prev, id)
    })
  }

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0)

  return (
    <div className="agent-input">
      {attachments.length > 0 && (
        <div className="agent-input__attachments">
          {attachments.map((a) => (
            <div className="agent-input__attachment" key={a.id}>
              <img src={a.url} alt={a.name} />
              <button
                type="button"
                className="agent-input__remove"
                onClick={() => removeAttachment(a.id)}
                aria-label={`移除 ${a.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="agent-input__row">
        <textarea
          ref={textareaRef}
          className="agent-input__textarea"
          placeholder="描述症状、追问判读结果，或 Ctrl+V 粘贴图片…"
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        {streaming ? (
          <button type="button" className="agent-input__stop" onClick={onStop}>
            停止
          </button>
        ) : (
          <button
            type="button"
            className="agent-input__send"
            disabled={!canSend}
            onClick={submit}
          >
            发送
          </button>
        )}
      </div>
      <div className="agent-input__hint num">ENTER 发送 · SHIFT+ENTER 换行</div>
    </div>
  )
}

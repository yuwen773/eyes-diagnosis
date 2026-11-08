import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react"
import { addFiles, removeById, type Attachment } from "@/lib/agentAttachments"
import { filterImageFiles } from "@/lib/agentUpload"

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
  const [hint, setHint] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    // 助手还在回复时不要把输入吞掉——保留文字并给出提示
    if (streaming) {
      setHint("助手正在回复，完成后即可发送")
      return
    }
    onSend(trimmed, attachments.map((a) => a.file))
    setText("")
    setAttachments([])
    setHint("")
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
    const images = filterImageFiles(pasted)
    if (images.length === 0) {
      setHint("只支持图片，且单张不超过 10MB")
      return
    }
    setAttachments((prev) => addFiles(prev, images, (f) => URL.createObjectURL(f)))
  }

  function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length === 0) return
    const images = filterImageFiles(picked)
    if (images.length < picked.length) {
      setHint("已忽略非图片或超过 10MB 的文件")
    }
    setAttachments((prev) => addFiles(prev, images, (f) => URL.createObjectURL(f)))
    // 允许再次选同一个文件
    e.target.value = ""
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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="agent-input__file"
          onChange={handleFilePick}
        />
        <button
          type="button"
          className="agent-input__attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="添加图片"
          title="添加图片"
        >
          ＋
        </button>
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
      <div className="agent-input__hint num">
        {hint || "ENTER 发送 · SHIFT+ENTER 换行"}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react"

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
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自适应高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [text])

  // 附件预览 URL：变更时 revoke 旧的
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  function submit() {
    const trimmed = text.trim()
    if ((!trimmed && files.length === 0) || disabled) return
    onSend(trimmed, files)
    setText("")
    setFiles([])
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
    setFiles((prev) => [...prev, ...pasted])
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const canSend = !disabled && (text.trim().length > 0 || files.length > 0)

  return (
    <div className="agent-input">
      {files.length > 0 && (
        <div className="agent-input__attachments">
          {previews.map((url, i) => (
            <div className="agent-input__attachment" key={`${files[i].name}-${i}`}>
              <img src={url} alt={files[i].name} />
              <button
                type="button"
                className="agent-input__remove"
                onClick={() => removeFile(i)}
                aria-label={`移除 ${files[i].name}`}
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

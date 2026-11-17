import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react"
import { addFiles, removeById, type Attachment } from "@/lib/agentAttachments"
import { filterImageFiles } from "@/lib/agentUpload"
import { clearDraft, loadDraft, saveDraft } from "@/lib/agentDraft"
import { useMediaQuery } from "@/lib/useMediaQuery"
import { PromptBar } from "./PromptBar"

/** 自适应高度上限。 */
const MAX_TEXTAREA_HEIGHT = 160

type ChatInputProps = {
  disabled: boolean
  streaming: boolean
  onSend: (text: string, files: File[]) => Promise<boolean>
  onStop: () => void
}

/**
 * 输入区：自适应 textarea + 粘贴图片附件 + 发送/停止。
 * Enter 发送 / Shift+Enter 换行；中文输入法组字中的 Enter 不发送（isComposing）。
 *
 * <p>视觉骨架在 `PromptBar`（本文件只管状态与行为）。草稿落盘节流、
 * 附件校验、上传失败回退这些既有契约一个字没改。
 *
 * 外部要打开选图对话框（欢迎屏的「上传眼底图像」）时持有 ref 调 `pickImage()`：
 * 文件对话框必须由用户手势同步触发（WebKit 要求），effect/信号派发在
 * Safari 上会丢掉手势资格。
 */
export type ChatInputHandle = {
  /** 打开选图对话框（必须来自用户手势的同步调用链）。 */
  pickImage: () => void
  /** 预填一句话并聚焦输入框（欢迎屏的引导问题走这里，不替用户发送）。 */
  prefill: (text: string) => void
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { disabled, streaming, onSend, onStop },
  ref,
) {
  // 草稿：跳登录页来回一趟不丢字。惰性初始化即可，不必用 effect 回填。
  const [text, setText] = useState(() => loadDraft())
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [hint, setHint] = useState("")
  const [focused, setFocused] = useState(false)
  // 窄屏放不下整串快捷键说明，只留最必要的一条。
  const narrow = useMediaQuery("(max-width: 768px)")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 草稿落盘分两条路径：打字节流（sessionStorage 是同步写，每个按键都写会拖慢
  // 输入），prefill / 清空仍立刻写（跳登录回来不丢字、发送后草稿必须当场消失）。
  const draftTimer = useRef<number | null>(null)
  const pendingDraft = useRef("")

  // 稳定引用：prefill 通过 useImperativeHandle 暴露出去，不能每次渲染换新函数。
  const updateText = useCallback((next: string) => {
    // 立刻写的场合必须先撤掉挂起的定时器，否则它会在发送后把旧草稿写回来。
    if (draftTimer.current !== null) {
      window.clearTimeout(draftTimer.current)
      draftTimer.current = null
    }
    setText(next)
    saveDraft(next)
  }, [])

  const typeText = useCallback((next: string) => {
    setText(next)
    pendingDraft.current = next
    if (draftTimer.current !== null) return
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null
      saveDraft(pendingDraft.current)
    }, 300)
  }, [])

  // 卸载时把还没落盘的那几个字补上：300ms 内离开页面不该丢草稿。
  // 卸载只覆盖「组件被拆掉」——刷新页面、关标签页都不卸载组件，
  // 所以还要挂 pagehide 兜底：那一下不会触发 React 的清理。
  useEffect(() => {
    const flush = () => {
      if (draftTimer.current === null) return
      window.clearTimeout(draftTimer.current)
      draftTimer.current = null
      saveDraft(pendingDraft.current)
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      pickImage: () => fileInputRef.current?.click(),
      prefill: (value: string) => {
        updateText(value)
        textareaRef.current?.focus({ preventScroll: true })
      },
    }),
    [updateText],
  )

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

  const submit = useCallback(async () => {
    const trimmed = text.trim()
    if ((!trimmed && attachments.length === 0) || disabled) return
    // 助手还在回复时不要把输入吞掉——保留文字并给出提示
    if (streaming) {
      setHint("助手正在回复，完成后即可发送")
      return
    }
    const ok = await onSend(trimmed, attachments.map((a) => a.file))
    if (!ok) {
      setHint("发送没成功，内容已保留，可以重试")
      textareaRef.current?.focus()
      return
    }
    attachments.forEach((a) => URL.revokeObjectURL(a.url))
    updateText("")
    setAttachments([])
    setHint("")
    clearDraft()
  }, [attachments, disabled, onSend, streaming, text, updateText])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return
    // 中文输入法组字确认的 Enter 不发送
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    void submit()
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
    // 选完图把焦点交回输入框：欢迎屏来的用户下一步就是写一句话。
    if (images.length > 0) textareaRef.current?.focus({ preventScroll: true })
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return removeById(prev, id)
    })
  }

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0)
  // 快捷键说明只出现在输入框占位符里；工具条上不再重复一遍。
  const placeholder =
    text.length === 0 && attachments.length === 0
      ? narrow
        ? "输入问题，Enter 发送"
        : "输入问题，Enter 发送 · Shift+Enter 换行 · Ctrl+V 粘贴图片"
      : ""

  return (
    <PromptBar
      text={text}
      onTextChange={typeText}
      attachments={attachments}
      onRemoveAttachment={removeAttachment}
      onPickFiles={() => fileInputRef.current?.click()}
      onSubmit={() => void submit()}
      onStop={onStop}
      streaming={streaming}
      disabled={disabled}
      canSend={canSend}
      hint={hint}
      placeholder={placeholder}
      focused={focused}
      onFocusedChange={setFocused}
      textareaRef={textareaRef}
      fileInputRef={fileInputRef}
      onFileChange={handleFilePick}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
    />
  )
})

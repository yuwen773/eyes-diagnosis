import type {
  ChangeEvent,
  ClipboardEvent,
  KeyboardEvent,
  RefObject,
} from "react"
import { Paperclip, Send, Square, X } from "lucide-react"

import type { Attachment } from "@/lib/agentAttachments"

/**
 * Prompt Bar —— 对话输入区的视觉骨架。
 *
 * <p>结构参考 React Bits 的 Prompt Bar 交互思路（附件在上、输入在中、
 * 工具条在下），实现是本仓库独立编写的：交互目标一样，代码与依赖都
 * 没有从上游搬运（见 `web/src/components/brand/THIRD-PARTY-NOTICES.md`）。
 *
 * <p>本组件**不含任何状态**：文本、附件、发送/停止、焦点都在
 * `ChatInput` 里。本文件只负责「怎么摆」——玻璃层次、聚焦环、工具钮的
 * hover / focus / disabled 三态、附件与文本的组合方式。
 */

export type PromptBarProps = {
  text: string
  onTextChange: (next: string) => void
  attachments: Attachment[]
  onRemoveAttachment: (id: string) => void
  /** 打开系统选图对话框（必须由用户手势同步触发）。 */
  onPickFiles: () => void
  onSubmit: () => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
  canSend: boolean
  /** 一次性提示（发送失败、格式不符等）。空时不占位。 */
  hint: string
  placeholder: string
  focused: boolean
  onFocusedChange: (focused: boolean) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

export function PromptBar({
  text,
  onTextChange,
  attachments,
  onRemoveAttachment,
  onPickFiles,
  onSubmit,
  onStop,
  streaming,
  disabled,
  canSend,
  hint,
  placeholder,
  focused,
  onFocusedChange,
  textareaRef,
  fileInputRef,
  onFileChange,
  onPaste,
  onKeyDown,
}: PromptBarProps) {
  return (
    <div className="prompt">
      <div className={`prompt__surface${focused ? " is-focused" : ""}`}>
        {attachments.length > 0 ? (
          <div className="prompt__attachments">
            {attachments.map((attachment) => (
              <span className="prompt__chip" key={attachment.id}>
                <img className="prompt__chip-img" src={attachment.url} alt={attachment.name} />
                <span className="prompt__chip-name">{attachment.name}</span>
                <button
                  type="button"
                  className="prompt__chip-remove"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  aria-label={`移除 ${attachment.name}`}
                >
                  <X size={12} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          className="prompt__input"
          placeholder={placeholder}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            onTextChange(event.target.value)
          }
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => onFocusedChange(true)}
          onBlur={() => onFocusedChange(false)}
        />

        <div className="prompt__toolbar">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="prompt__file"
            onChange={onFileChange}
          />
          <button
            type="button"
            className="prompt__tool"
            onClick={onPickFiles}
            disabled={disabled}
            aria-label="添加图片"
            title="添加图片"
          >
            <Paperclip size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>

          <span className="prompt__meta" role={hint ? "status" : undefined}>
            {hint}
          </span>

          {streaming ? (
            <button
              type="button"
              className="prompt__action is-stop"
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
            >
              <Square size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="prompt__action is-send"
              disabled={!canSend}
              onClick={onSubmit}
              aria-label="发送"
              title="发送"
            >
              <Send size={17} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <p className="prompt__note">内容由AI生成，仅供参考，不能替代执业医师的检查与判断。</p>
    </div>
  )
}

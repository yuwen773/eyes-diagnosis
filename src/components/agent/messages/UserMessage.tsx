import type { StreamMessage } from "@/lib/agentStream"

/**
 * 用户消息：排版复刻 Vue 版 UserMessage——右对齐圆角气泡 +
 * 气泡下方 48px 图片网格（最多 4 张，多于 4 张在角落叠 +N）。
 * 气泡底/边走反相带令牌（--dark-surface / --dark-line）。
 */
export function UserMessage({ msg, onPreviewImage }: { msg: StreamMessage; onPreviewImage?: (url: string) => void }) {
  const images = msg.images ?? []
  const shown = images.slice(0, 4)
  const more = images.length - shown.length
  const gridCols = Math.min(images.length, 4)

  return (
    <div className="agent-msg--user">
      {images.length > 0 && (
        <div className={`agent-msg__imggrid grid-${gridCols}`}>
          {shown.map((url) => (
            <button
              type="button"
              className="agent-msg__thumb"
              key={url}
              onClick={() => onPreviewImage?.(url)}
              aria-label="查看图片"
            >
              <img src={url} alt="上传图片" loading="lazy" />
            </button>
          ))}
          {more > 0 && <span className="agent-msg__imgmore num">+{more}</span>}
        </div>
      )}
      {(msg.content || msg.time) && (
        <div className="agent-msg__bubble-user">
          {msg.content && <div className="agent-msg__text">{msg.content}</div>}
          {msg.time && <div className="agent-msg__time num">{msg.time}</div>}
        </div>
      )}
    </div>
  )
}

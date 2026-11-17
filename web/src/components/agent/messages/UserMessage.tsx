import type { StreamMessage } from "@/lib/agentStream"

/**
 * 用户消息：轻量玻璃气泡（右对齐）+ 气泡下方图片网格。
 *
 * <p>气泡用玻璃层而不是实心色块：用户的话是「输入」，不该比 Iris 的
 * 回答更重。图片网格最多 4 张，多于 4 张在角落叠 +N。
 */
export function UserMessage({ msg, onPreviewImage }: { msg: StreamMessage; onPreviewImage?: (url: string) => void }) {
  const images = msg.images ?? []
  const shown = images.slice(0, 4)
  const more = images.length - shown.length
  const gridCols = Math.min(images.length, 4)

  return (
    <article className="agent-msg agent-msg--user">
      {images.length > 0 ? (
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
          {more > 0 ? <span className="agent-msg__imgmore">+{more}</span> : null}
        </div>
      ) : null}
      {(msg.content || msg.time) && (
        <div className="agent-msg__bubble-user">
          {msg.content && <div className="agent-msg__text">{msg.content}</div>}
          {msg.time && <div className="agent-msg__time">{msg.time}</div>}
        </div>
      )}
    </article>
  )
}

import type { StreamMessage } from "@/lib/agentStream"

/** 用户消息：右对齐 + 图片缩略图网格。无时间戳不显示时间。 */
export function UserMessage({ msg }: { msg: StreamMessage }) {
  const shown = msg.images?.slice(0, 4) ?? []
  const more = (msg.images?.length ?? 0) - shown.length

  return (
    <div className="trace agent-msg agent-msg--user">
      <div className="trace__role">USER</div>
      <div className="trace__content agent-msg--user__body">
        {shown.length > 0 && (
          <div className="agent-msg__imggrid">
            {shown.map((url) => (
              <img key={url} src={url} alt="上传图片" loading="lazy" />
            ))}
            {more > 0 && <span className="agent-msg__imgmore num">+{more}</span>}
          </div>
        )}
        {msg.content && <div className="trace__text">{msg.content}</div>}
        {msg.time && <div className="trace__note num">{msg.time}</div>}
      </div>
    </div>
  )
}

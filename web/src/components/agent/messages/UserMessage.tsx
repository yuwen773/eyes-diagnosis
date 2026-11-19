import { isTrustedAttachmentUrl } from "@/lib/agentResources"
import type { StreamMessage } from "@/lib/agentStream"

/**
 * 送达状态只说实话，而且只在「不能确定服务端有这条」时出现。
 *
 * <p>`sending` 是常态，不打扰；`accepted`（以及历史消息的缺省态）表示
 * 服务端已有记录，也不需要说话；只有 `unconfirmed` 和 `failed` 需要
 * 让人知道「这条可能没到，别以为对方看见了」。
 */
const DELIVERY_NOTE: Partial<Record<NonNullable<StreamMessage["delivery"]>, { mark: string; text: string }>> = {
  sending: { mark: "…", text: "发送中" },
  unconfirmed: { mark: "?", text: "送达未确认 · 刷新后可核对" },
  // 只有服务端**明确拒绝**（未登录 / 无权限）才走到这里。查不到历史不算——
  // 落库是异步的，长会话的历史分页也未必带得到刚发的那条。
  failed: { mark: "!", text: "未送达 · 服务端拒绝了这次请求" },
}

/**
 * 用户消息：轻量玻璃气泡（右对齐）+ 气泡下方图片网格。
 *
 * <p>气泡用玻璃层而不是实心色块：用户的话是「输入」，不该比 Iris 的
 * 回答更重。图片网格最多 4 张，多于 4 张在角落叠 +N。
 */
export function UserMessage({ msg, onPreviewImage }: { msg: StreamMessage; onPreviewImage?: (url: string) => void }) {
  // 第二道闸：即使消息体带上了 images，也只渲染服务端上传命名空间里的地址。
  const images = (msg.images ?? []).filter(isTrustedAttachmentUrl)
  const shown = images.slice(0, 4)
  const more = images.length - shown.length
  const gridCols = Math.min(images.length, 4)
  const delivery = msg.delivery ? DELIVERY_NOTE[msg.delivery] : undefined

  return (
    <article className="agent-msg agent-msg--user" data-msg-id={msg.id}>
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
      {delivery ? (
        /* 刻意不加 role="status"：失败已经在 FaultToaster 里播报过一次，
           每条消息再各自开一个 live region 会让读屏用户听到两遍。读数本身
           仍在可访问树里，逐条回看时读得到。 */
        <div className={`agent-msg__delivery is-${msg.delivery}`}>
          <span className="agent-msg__delivery-mark" aria-hidden="true">
            {delivery.mark}
          </span>
          {delivery.text}
        </div>
      ) : null}
    </article>
  )
}

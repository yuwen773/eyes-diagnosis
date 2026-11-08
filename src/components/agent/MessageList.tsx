import { useEffect, useRef, useState } from "react"
import type { StreamMessage } from "@/lib/agentStream"
import { computeUnread } from "@/lib/agentScroll"
import { UserMessage } from "./messages/UserMessage"
import { AssistantMessage } from "./messages/AssistantMessage"
import { ReasoningMessage } from "./messages/ReasoningMessage"
import { ToolRequestMessage } from "./messages/ToolRequestMessage"
import { ToolResponseMessage } from "./messages/ToolResponseMessage"
import { ConfirmMessage } from "./messages/ConfirmMessage"
import { WelcomeScreen } from "./WelcomeScreen"

/** 距底 80px 内视为贴底。 */
const BOTTOM_EPSILON = 80

function MessageRow({ msg, onPreviewImage }: { msg: StreamMessage; onPreviewImage?: (url: string) => void }) {
  switch (msg.type) {
    case "user":
      return <UserMessage msg={msg} onPreviewImage={onPreviewImage} />
    case "assistant":
      return <AssistantMessage msg={msg} />
    case "reasoning":
      return <ReasoningMessage msg={msg} />
    case "tool-request":
      return <ToolRequestMessage msg={msg} />
    case "tool-response":
      return <ToolResponseMessage msg={msg} />
    case "confirm":
      return <ConfirmMessage msg={msg} />
    default:
      return null
  }
}

/**
 * 消息列表：`.console is-dark` 暗底反相带包裹滚动区（与落地页演示屏同语）。
 * `is-dark` 是反相带的令牌映射开关——缺了它，正文会拿页面级的深墨令牌
 * 压在深色屏上，亮色主题下直接看不见字。
 *
 * 贴底时跟随新消息与流式累加滚动；不贴底时显示未读悬浮按钮（只按新消息计数）。
 */
export function MessageList({
  messages,
  loading,
  streaming,
  onSend,
  onPreviewImage,
}: {
  messages: StreamMessage[]
  loading: boolean
  streaming: boolean
  onSend: (text: string) => void
  onPreviewImage?: (url: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const [unread, setUnread] = useState(0)

  const lastMsg = messages[messages.length - 1]
  const lastMsgId = lastMsg?.id
  const lastContent = lastMsg?.content

  // 滚动容器始终是同一个元素（欢迎屏也渲染在它里面），
  // 否则监听器会挂不上，用户上翻读历史时被强行拉回底部。
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_EPSILON
      atBottomRef.current = near
      if (near) setUnread(0)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  // 新消息：贴底则跟随，否则计一条未读
  useEffect(() => {
    const el = listRef.current
    if (!el || messages.length === 0) return
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    } else {
      setUnread((n) => computeUnread(n, { atBottom: false, isNewMessage: true, isContentGrowth: false }))
    }
    // 只跟消息条数：内容增长在下面的 effect 里处理
  }, [messages.length])

  // 流式内容增长：贴底时跟随滚动，但不增加未读计数
  useEffect(() => {
    const el = listRef.current
    if (!el || lastContent === undefined) return
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [lastContent, lastMsgId])

  function scrollToBottom() {
    const el = listRef.current
    if (!el) return
    atBottomRef.current = true
    setUnread(0)
    el.scrollTop = el.scrollHeight
  }

  const empty = messages.length === 0 && !loading

  return (
    <div className="agent-console">
      <div className="console__head">
        <span className="console__title">DIAGNOSIS · AGENT</span>
        {streaming ? (
          <span className="console__live">LIVE</span>
        ) : (
          <span className="console__meta">{messages.length} MSG</span>
        )}
      </div>
      <div className="console__body agent-msglist" ref={listRef}>
        {loading && <div className="agent-load">读取历史会话…</div>}
        {empty && <WelcomeScreen onSend={onSend} />}
        {messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} onPreviewImage={onPreviewImage} />
        ))}
        {/* 打字指示器：排版复刻 Vue 版 typing-pill（三条跳动竖条） */}
        {streaming && (
          <div className="typing-row">
            <div className="typing-pill" aria-label="正在输入">
              <span className="typing-bar" />
              <span className="typing-bar" />
              <span className="typing-bar" />
            </div>
          </div>
        )}
      </div>
      {unread > 0 && (
        <button type="button" className="agent-msglist__unread num" onClick={scrollToBottom}>
          ↓ {unread} 条新消息
        </button>
      )}
    </div>
  )
}

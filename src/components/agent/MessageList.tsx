import { useEffect, useRef, useState } from "react"
import type { StreamMessage } from "@/lib/agentStream"
import { UserMessage } from "./messages/UserMessage"
import { AssistantMessage } from "./messages/AssistantMessage"
import { ReasoningMessage } from "./messages/ReasoningMessage"
import { ToolRequestMessage } from "./messages/ToolRequestMessage"
import { ToolResponseMessage } from "./messages/ToolResponseMessage"
import { ConfirmMessage } from "./messages/ConfirmMessage"
import { WelcomeScreen } from "./WelcomeScreen"

/** 距底 80px 内视为贴底。 */
const BOTTOM_EPSILON = 80

function MessageRow({ msg }: { msg: StreamMessage }) {
  switch (msg.type) {
    case "user":
      return <UserMessage msg={msg} />
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
 * 消息列表：`.console` 暗底反相带包裹滚动区（与落地页演示屏同语）。
 * 贴底时跟随新消息与流式累加滚动；不贴底时显示未读悬浮按钮。
 */
export function MessageList({
  messages,
  loading,
  streaming,
  onSend,
}: {
  messages: StreamMessage[]
  loading: boolean
  streaming: boolean
  onSend: (text: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const [unread, setUnread] = useState(0)

  const lastMsg = messages[messages.length - 1]

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

  // 新消息或流式累加时：贴底则跟随，否则计未读
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    } else if (lastMsg) {
      setUnread((n) => n + 1)
    }
    // 依赖最后一条消息的内容：流式累加每片都触发
  }, [messages.length, lastMsg?.content, lastMsg?.id])

  function scrollToBottom() {
    const el = listRef.current
    if (!el) return
    atBottomRef.current = true
    setUnread(0)
    el.scrollTop = el.scrollHeight
  }

  if (messages.length === 0 && !loading) {
    return (
      <div className="console agent-console">
        <div className="console__head">
          <span className="console__title">DIAGNOSIS · AGENT</span>
          <span className="console__meta">SSE · STREAM READY</span>
        </div>
        <div className="console__body">
          <WelcomeScreen onSend={onSend} />
        </div>
      </div>
    )
  }

  return (
    <div className="console agent-console">
      <div className="console__head">
        <span className="console__title">DIAGNOSIS · AGENT</span>
        {streaming ? (
          <span className="console__live">LIVE</span>
        ) : (
          <span className="console__meta">{messages.length} MSG</span>
        )}
      </div>
      <div className="console__body agent-msglist" ref={listRef}>
        {messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}
        {streaming && (
          <div className="trace agent-msg">
            <div className="trace__role">AGENT</div>
            <div className="trace__content">
              <span className="console__live agent-msg__live-inline">THINKING</span>
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

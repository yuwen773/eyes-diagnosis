import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type { StreamMessage } from "@/lib/agentStream"
import { buildThread } from "@/lib/agentSteps"
import { computeUnread } from "@/lib/agentScroll"
import { UserMessage } from "./messages/UserMessage"
import { AssistantMessage } from "./messages/AssistantMessage"
import { ThoughtLine } from "./ThoughtLine"
import { LatticeLoader } from "./LatticeLoader"
import { WelcomeScreen } from "./WelcomeScreen"

/** 距底 80px 内视为贴底。 */
const BOTTOM_EPSILON = 80

/**
 * 单条消息行。memo 的前提在上游已成立：applyStreamEvent 累加时保留历史
 * 消息的对象引用，只有正在流式的那一条会换新对象。因此每片 token 只需
 * 重渲染最后一行，而不是整个列表。
 */
const MessageRow = memo(function MessageRow({
  msg,
  onPreviewImage,
}: {
  msg: StreamMessage
  onPreviewImage?: (url: string) => void
}) {
  switch (msg.type) {
    case "user":
      return <UserMessage msg={msg} onPreviewImage={onPreviewImage} />
    case "assistant":
      return <AssistantMessage msg={msg} />
    default:
      // reasoning / tool-* / confirm 都在 buildThread 里并入「执行过程」块，
      // 不再逐条平铺。走到这里的只可能是历史数据里的未知类型，不渲染。
      return null
  }
})

/**
 * 消息区：中央阅读列 + 真实事件驱动的执行过程。
 *
 * <p>**不再有仪器读数。** 旧版的 `DIAGNOSIS · AGENT` 头与 `N MSG` 计数
 * 已从主视觉里去掉——它们既不携带信息，也把页面拉回「控制台」的语气。
 * 顶栏只留当前会话的真实标题与两个操作钮。
 *
 * <p>正文列宽上限 820px 并水平居中：对话是读物，不是仪表盘，
 * 正文贴着左边缘、右侧留一大片空白是旧版最刺眼的结构问题。
 */
export function MessageList({
  messages,
  loading,
  streaming,
  waiting,
  title,
  onSend,
  onPreviewImage,
  onPickImage,
  headLeft,
  headRight,
}: {
  messages: StreamMessage[]
  loading: boolean
  streaming: boolean
  /** 等第一条真实事件到达：上传中 / 等待首个回复。 */
  waiting: { active: boolean; label: string }
  /** 当前会话的真实标题（空会话不显示）。 */
  title?: string
  onSend: (text: string) => void
  onPreviewImage?: (url: string) => void
  /** 欢迎屏「上传眼底图像」：预填引导句并打开输入区的选图对话框。 */
  onPickImage: (prefill: string) => void
  /** 顶栏左侧插槽：折叠后的左栏操作钮组。 */
  headLeft?: ReactNode
  /** 顶栏右侧插槽：资源面板切换钮。 */
  headRight?: ReactNode
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

  // 贴底跟随合帧：读 scrollHeight 会强制一次同步布局，SSE 每片都读就是每片
  // 一次回流。用 rAF 把同一帧内的多次请求并成一次读 + 一次写。
  const followRaf = useRef<number | null>(null)
  const followBottom = useCallback(() => {
    if (followRaf.current !== null) return
    followRaf.current = requestAnimationFrame(() => {
      followRaf.current = null
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  useEffect(
    () => () => {
      if (followRaf.current !== null) cancelAnimationFrame(followRaf.current)
    },
    [],
  )

  // 新消息：贴底则跟随，否则计一条未读
  useEffect(() => {
    if (messages.length === 0) return
    if (atBottomRef.current) {
      followBottom()
    } else {
      setUnread((n) => computeUnread(n, { atBottom: false, isNewMessage: true, isContentGrowth: false }))
    }
    // 只跟消息条数：内容增长在下面的 effect 里处理
  }, [messages.length, followBottom])

  // 流式内容增长：贴底时跟随滚动，但不增加未读计数
  useEffect(() => {
    if (lastContent === undefined) return
    if (atBottomRef.current) followBottom()
  }, [lastContent, lastMsgId, followBottom])

  function scrollToBottom() {
    const el = listRef.current
    if (!el) return
    atBottomRef.current = true
    setUnread(0)
    el.scrollTop = el.scrollHeight
  }

  const empty = messages.length === 0 && !loading
  // 过程块只由真实事件派生；消息对象引用在累加时保持稳定，
  // 所以历史行仍然被 memo 跳过，只有正在流式的那一行会重渲染。
  const thread = useMemo(() => buildThread(messages, streaming), [messages, streaming])

  return (
    <div className="agent-thread">
      <div className="agent-thread__bar">
        <div className="agent-thread__bar-side">{headLeft}</div>
        <div className="agent-thread__bar-center">
          {title ? <h1 className="agent-thread__title">{title}</h1> : null}
        </div>
        <div className="agent-thread__bar-side is-right">{headRight}</div>
      </div>

      <div className="agent-thread__scroll" ref={listRef}>
        <div className={`agent-thread__column${empty ? " is-empty" : ""}`}>
          {loading ? <div className="agent-load">读取历史会话…</div> : null}
          {empty ? <WelcomeScreen onSend={onSend} onPickImage={onPickImage} /> : null}

          {thread.map((item) =>
            item.type === "process" ? (
              <ThoughtLine key={item.id} steps={item.steps} />
            ) : (
              <MessageRow
                key={item.message.id}
                msg={item.message}
                onPreviewImage={onPreviewImage}
              />
            ),
          )}
        </div>
      </div>

      {/* 等待态独立成一条，不塞进滚动列：塞进去会被列底裁掉半截，
          而它恰恰是用户最该看见的一行。 */}
      {waiting.active ? (
        <div className="agent-thread__status">
          <LatticeLoader label={waiting.label} />
        </div>
      ) : null}

      {unread > 0 ? (
        <button type="button" className="agent-msglist__unread" onClick={scrollToBottom}>
          <span className="agent-msglist__unread-dot" aria-hidden="true" />
          {unread} 条新消息
        </button>
      ) : null}
    </div>
  )
}
